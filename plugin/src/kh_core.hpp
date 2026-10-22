// KH 120 A Corrector — núcleo DSP independiente del framework (DPF, JUCE, iPlug2, app de sistema...).
// Convolución particionada uniforme (overlap-save) con PFFFT, limitador de seguridad con anticipación,
// bypass seguro (misma ganancia y latencia) y cambio de filtro con fundido.
// Nada de lo que se llama desde process() reserva memoria ni bloquea.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include "pffft.h"
#include "kh_firs.hpp"

namespace kh {

struct ABuf {
    float* p = nullptr;
    size_t n = 0;
    void alloc(size_t count) {
        release();
        n = count;
        p = static_cast<float*>(pffft_aligned_malloc(n * sizeof(float)));
        zero();
    }
    void zero() { if (p) std::memset(p, 0, n * sizeof(float)); }
    void release() { if (p) pffft_aligned_free(p); p = nullptr; n = 0; }
    ~ABuf() { release(); }
};

// Convolución de 1 canal, bloques de B muestras. Latencia propia: 0 (la añade el FIFO de Corrector).
class Convolver {
public:
    bool init(PFFFT_Setup* setup, int B, const float* ir, int n) {
        setup_ = setup;
        B_ = B;
        N_ = 2 * B;
        P_ = (n + B - 1) / B;
        irSpec_.alloc((size_t)P_ * N_);
        fdl_.alloc((size_t)P_ * N_);
        time_.alloc(N_);
        acc_.alloc(N_);
        tmp_.alloc(N_);
        work_.alloc(N_);
        const float scale = 1.0f / (float)N_;
        for (int k = 0; k < P_; ++k) {
            tmp_.zero();
            const int cnt = std::min(B_, n - k * B_);
            for (int i = 0; i < cnt; ++i) tmp_.p[i] = ir[k * B_ + i] * scale;
            pffft_transform(setup_, tmp_.p, irSpec_.p + (size_t)k * N_, work_.p, PFFFT_FORWARD);
        }
        idx_ = 0;
        return true;
    }
    void reset() { fdl_.zero(); time_.zero(); idx_ = 0; }
    void processBlock(const float* in, float* out) {
        std::memmove(time_.p, time_.p + B_, B_ * sizeof(float));
        std::memcpy(time_.p + B_, in, B_ * sizeof(float));
        pffft_transform(setup_, time_.p, fdl_.p + (size_t)idx_ * N_, work_.p, PFFFT_FORWARD);
        acc_.zero();
        for (int k = 0; k < P_; ++k) {
            int j = idx_ - k;
            if (j < 0) j += P_;
            pffft_zconvolve_accumulate(setup_, fdl_.p + (size_t)j * N_, irSpec_.p + (size_t)k * N_, acc_.p, 1.0f);
        }
        pffft_transform(setup_, acc_.p, tmp_.p, work_.p, PFFFT_BACKWARD);
        std::memcpy(out, tmp_.p + B_, B_ * sizeof(float));
        idx_ = (idx_ + 1) % P_;
    }
private:
    PFFFT_Setup* setup_ = nullptr;
    int B_ = 0, N_ = 0, P_ = 0, idx_ = 0;
    ABuf irSpec_, fdl_, time_, acc_, tmp_, work_;
};

// Limitador de pico estéreo enlazado con anticipación L: ventana de mínimo de 2L + media móvil de L.
class SafetyLimiter {
public:
    void init(int L, double fs) {
        L_ = L;
        gwin_.alloc(2 * L);
        box_.alloc(L);
        dl_[0].alloc(L + 1);
        dl_[1].alloc(L + 1);
        rel_ = (float)(1.0 - std::exp(-1.0 / (0.100 * fs)));   // 100 ms
        reset();
    }
    void reset() {
        for (size_t i = 0; i < gwin_.n; ++i) gwin_.p[i] = 1.0f;
        for (size_t i = 0; i < box_.n; ++i) box_.p[i] = 1.0f;
        dl_[0].zero(); dl_[1].zero();
        boxSum_ = (float)L_; env_ = 1.0f; wpos_ = bpos_ = dpos_ = 0; minGain_ = 1.0f;
    }
    // Siempre retrasa L muestras (latencia constante); si enabled=false no reduce ganancia.
    inline void process(float& l, float& r, bool enabled) {
        const float pk = std::max(std::fabs(l), std::fabs(r));
        float greq = 1.0f;
        if (enabled && pk > kThr) greq = kThr / pk;
        gwin_.p[wpos_] = greq;
        wpos_ = (wpos_ + 1) % (2 * L_);
        float gmin = 1.0f;
        for (int i = 0; i < 2 * L_; ++i) gmin = std::min(gmin, gwin_.p[i]);
        boxSum_ += gmin - box_.p[bpos_];
        box_.p[bpos_] = gmin;
        bpos_ = (bpos_ + 1) % L_;
        const float gs = boxSum_ / (float)L_;
        if (gs < env_) env_ = gs; else env_ += (gs - env_) * rel_;
        if (!enabled) env_ = 1.0f;
        // línea de retardo de L muestras
        dl_[0].p[dpos_] = l; dl_[1].p[dpos_] = r;
        const int rpos = (dpos_ + 1) % (L_ + 1);
        l = dl_[0].p[rpos] * env_;
        r = dl_[1].p[rpos] * env_;
        dpos_ = rpos;
        // red de seguridad final (no debería actuar nunca)
        l = std::max(-kCeil, std::min(kCeil, l));
        r = std::max(-kCeil, std::min(kCeil, r));
        minGain_ = std::min(minGain_, env_);
    }
    float takeMinGain() { float g = minGain_; minGain_ = 1.0f; return g; }
    int latency() const { return L_; }
    static constexpr float kThr = 0.944f;    // -0,5 dBFS
    static constexpr float kCeil = 0.999f;
private:
    int L_ = 32, wpos_ = 0, bpos_ = 0, dpos_ = 0;
    float rel_ = 0.0f, boxSum_ = 0.0f, env_ = 1.0f, minGain_ = 1.0f;
    ABuf gwin_, box_, dl_[2];
};

class Corrector {
public:
    enum Variant { LIN50 = 0, EXT40 = 1 };
    enum Phase { LINEAR = 0, LOWLAT = 1 };

    ~Corrector() { freeSetup(); }

    // No es tiempo real: llamar al activar o al cambiar la frecuencia de muestreo.
    void prepare(double fs) {
        fs_ = fs;
        supported_ = false;
        freeSetup();
        const uint32_t ifs = (uint32_t)std::lround(fs);
        int found = 0;
        for (const auto& f : khfir::kFirs) if (f.fs == ifs) ++found;
        att_ = std::pow(10.0f, -khfir::kAttenuationDb / 20.0f);
        fadeLen_ = std::max(1, (int)(0.015 * fs));
        limiter_.init(fs > 50000 ? 64 : 32, fs);
        if (found == 4) {
            B_ = fs > 50000 ? 128 : 64;
            setup_ = pffft_new_setup(2 * B_, PFFFT_REAL);
            int maxLat = 0;
            for (const auto& f : khfir::kFirs) {
                if (f.fs != ifs) continue;
                const int slot = f.variant * 2 + f.phase;
                for (int c = 0; c < 2; ++c) conv_[slot][c].init(setup_, B_, f.h, (int)f.n);
                firLat_[slot] = (int)f.latency;
                maxLat = std::max(maxLat, (int)f.latency);
            }
            inFifo_[0].alloc(B_); inFifo_[1].alloc(B_);
            outFifo_[0].alloc(B_); outFifo_[1].alloc(B_);
            bypLen_ = maxLat + B_ + 1;
            byp_[0].alloc(bypLen_); byp_[1].alloc(bypLen_);
            supported_ = true;
        }
        reset();
    }

    void reset() {
        if (supported_) {
            for (auto& s : conv_) for (auto& c : s) c.reset();
            inFifo_[0].zero(); inFifo_[1].zero(); outFifo_[0].zero(); outFifo_[1].zero();
            byp_[0].zero(); byp_[1].zero();
        }
        limiter_.reset();
        fifoPos_ = 0; bypPos_ = 0;
        activeSlot_ = reqVariant_ * 2 + reqPhase_;
        procMix_ = reqBypass_ ? 0.0f : 1.0f;
        fade_ = 0; fadeState_ = FADE_IN;     // arranque suave
        peak_ = 0.0f;
    }

    // Parámetros (se pueden llamar desde cualquier hilo; se aplican en process()).
    void setVariant(int v) { reqVariant_ = v ? 1 : 0; }
    void setPhase(int p) { reqPhase_ = p ? 1 : 0; }
    void setBypass(bool b) { reqBypass_ = b; }
    void setLimiter(bool on) { limiterOn_ = on; }
    void setTrimDb(float db) { trim_ = std::pow(10.0f, std::min(0.0f, std::max(-24.0f, db)) / 20.0f); }

    bool supported() const { return supported_; }
    int latencySamples() const {
        if (!supported_) return limiter_.latency();
        return B_ + firLat_[activeSlot_] + limiter_.latency();
    }
    float takePeakDb() { float p = peak_; peak_ = 0.0f; return p > 1e-9f ? 20.0f * std::log10(p) : -120.0f; }
    float takeGainReductionDb() { return 20.0f * std::log10(std::max(1e-6f, limiter_.takeMinGain())); }

    void process(const float* inL, const float* inR, float* outL, float* outR, uint32_t n) {
        const float procStep = 1.0f / (float)fadeLen_;
        for (uint32_t i = 0; i < n; ++i) {
            const float xl = sane(inL[i]), xr = sane(inR[i]);
            float yl, yr;
            if (!supported_) {
                yl = xl * att_; yr = xr * att_;
            } else {
                // 1) FIFO de bloques para la convolución
                inFifo_[0].p[fifoPos_] = xl;
                inFifo_[1].p[fifoPos_] = xr;
                const float cl = outFifo_[0].p[fifoPos_];
                const float cr = outFifo_[1].p[fifoPos_];
                if (++fifoPos_ == B_) {
                    fifoPos_ = 0;
                    conv_[activeSlot_][0].processBlock(inFifo_[0].p, outFifo_[0].p);
                    conv_[activeSlot_][1].processBlock(inFifo_[1].p, outFifo_[1].p);
                }
                // 2) bypass seguro: misma atenuación y misma latencia que el filtro activo
                byp_[0].p[bypPos_] = xl;
                byp_[1].p[bypPos_] = xr;
                const int d = B_ + firLat_[activeSlot_];
                int rp = bypPos_ - d;
                if (rp < 0) rp += bypLen_;
                const float bl = byp_[0].p[rp] * att_, br = byp_[1].p[rp] * att_;
                if (++bypPos_ == bypLen_) bypPos_ = 0;
                // 3) mezcla filtro/bypass con rampa
                const float tgt = reqBypass_ ? 0.0f : 1.0f;
                if (procMix_ < tgt) procMix_ = std::min(tgt, procMix_ + procStep);
                else if (procMix_ > tgt) procMix_ = std::max(tgt, procMix_ - procStep);
                yl = procMix_ * cl + (1.0f - procMix_) * bl;
                yr = procMix_ * cr + (1.0f - procMix_) * br;
            }
            // 4) fundido para cambios de filtro/fase y arranque
            const float g = fadeGain();
            yl *= g * trim_;
            yr *= g * trim_;
            if (!std::isfinite(yl) || !std::isfinite(yr)) { yl = yr = 0.0f; nanSeen_ = true; }
            // 5) limitador de seguridad (latencia constante)
            limiter_.process(yl, yr, limiterOn_);
            outL[i] = yl;
            outR[i] = yr;
            peak_ = std::max(peak_, std::max(std::fabs(yl), std::fabs(yr)));
        }
        if (nanSeen_) { nanSeen_ = false; if (supported_) for (auto& s : conv_) for (auto& c : s) c.reset(); }
    }

private:
    enum FadeState { STEADY, FADE_OUT, FADE_IN };
    static inline float sane(float x) { return std::isfinite(x) ? x : 0.0f; }

    float fadeGain() {
        const int want = reqVariant_ * 2 + reqPhase_;
        if (fadeState_ == STEADY && supported_ && want != activeSlot_) { fadeState_ = FADE_OUT; fade_ = fadeLen_; }
        if (fadeState_ == FADE_OUT) {
            if (--fade_ <= 0) {
                activeSlot_ = want;                      // cambio con la salida en silencio
                conv_[activeSlot_][0].reset();
                conv_[activeSlot_][1].reset();
                fadeState_ = FADE_IN; fade_ = 0;
                return 0.0f;
            }
            return (float)fade_ / (float)fadeLen_;
        }
        if (fadeState_ == FADE_IN) {
            // espera a que el filtro recién reiniciado haya llenado su latencia antes de abrir
            const int hold = supported_ ? B_ + firLat_[activeSlot_] : 0;
            ++fade_;
            if (fade_ <= hold) return 0.0f;
            const float g = (float)(fade_ - hold) / (float)fadeLen_;
            if (g >= 1.0f) { fadeState_ = STEADY; return 1.0f; }
            return g;
        }
        return 1.0f;
    }

    void freeSetup() { if (setup_) { pffft_destroy_setup(setup_); setup_ = nullptr; } }

    double fs_ = 48000.0;
    bool supported_ = false;
    PFFFT_Setup* setup_ = nullptr;
    int B_ = 64;
    Convolver conv_[4][2];
    int firLat_[4] = {0, 0, 0, 0};
    ABuf inFifo_[2], outFifo_[2], byp_[2];
    int fifoPos_ = 0, bypPos_ = 0, bypLen_ = 1;
    SafetyLimiter limiter_;
    float att_ = 0.25f, trim_ = 1.0f, procMix_ = 1.0f, peak_ = 0.0f;
    int fadeLen_ = 720, fade_ = 0;
    FadeState fadeState_ = FADE_IN;
    int activeSlot_ = 0;
    bool nanSeen_ = false;
    volatile int reqVariant_ = 0, reqPhase_ = 0;
    volatile bool reqBypass_ = false, limiterOn_ = true;
};

} // namespace kh
