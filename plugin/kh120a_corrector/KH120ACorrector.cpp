// KH120A Corrector — envoltorio DPF (VST3 / CLAP / LV2) del núcleo kh::Corrector.
// FILTROS PROVISIONALES: modelo calibrado con datos publicados, sin medidas propias.
#include "DistrhoPlugin.hpp"
#include "kh_core.hpp"

START_NAMESPACE_DISTRHO

enum Params {
    pFiltro = 0, pFase, pBypass, pLimitador, pRecorte,
    pPico, pReduccion, pLatencia, pEstado,
    pCount
};

class KH120ACorrector : public Plugin {
public:
    KH120ACorrector() : Plugin(pCount, 0, 0) {
        core_.prepare(getSampleRate());
        reportLatency();
    }

protected:
    const char* getLabel() const override { return "KH120ACorrector"; }
    const char* getDescription() const override {
        return "Correccion FIR PROVISIONAL para Neumann KH 120 A: fase lineal, subsonico y "
               "atenuacion previa de -12 dB. Desactivalo al exportar.";
    }
    const char* getMaker() const override { return "napalmcandy"; }
    const char* getHomePage() const override { return "https://claude.ai/code"; }
    const char* getLicense() const override { return "ISC"; }
    uint32_t getVersion() const override { return d_version(0, 1, 0); }

    void initParameter(uint32_t index, Parameter& p) override {
        p.hints = kParameterIsAutomatable;
        switch (index) {
        case pFiltro: {
            p.name = "Filtro"; p.symbol = "filtro";
            p.hints |= kParameterIsInteger;
            p.ranges.min = 0; p.ranges.max = 1; p.ranges.def = 0;
            static ParameterEnumerationValue v[2] = {
                {0.0f, "LIN50 (sin extension, diario)"},
                {1.0f, "EXT40 (grave a 40 Hz, volumen moderado)"}};
            p.enumValues.count = 2; p.enumValues.restrictedMode = true; p.enumValues.values = v;
            p.enumValues.deleteLater = false;
            break; }
        case pFase: {
            p.name = "Fase"; p.symbol = "fase";
            p.hints |= kParameterIsInteger;
            p.ranges.min = 0; p.ranges.max = 1; p.ranges.def = 0;
            static ParameterEnumerationValue v[2] = {
                {0.0f, "Fase lineal (mezcla, ~87 ms)"},
                {1.0f, "Baja latencia (grabar, ~3 ms)"}};
            p.enumValues.count = 2; p.enumValues.restrictedMode = true; p.enumValues.values = v;
            p.enumValues.deleteLater = false;
            break; }
        case pBypass:
            p.name = "Bypass seguro (-12 dB)"; p.symbol = "bypass_seguro";
            p.hints |= kParameterIsBoolean;
            p.ranges.min = 0; p.ranges.max = 1; p.ranges.def = 0;
            break;
        case pLimitador:
            p.name = "Limitador de seguridad"; p.symbol = "limitador";
            p.hints |= kParameterIsBoolean;
            p.ranges.min = 0; p.ranges.max = 1; p.ranges.def = 1;
            break;
        case pRecorte:
            p.name = "Recorte de salida"; p.symbol = "recorte"; p.unit = "dB";
            p.ranges.min = -24.0f; p.ranges.max = 0.0f; p.ranges.def = 0.0f;
            break;
        case pPico:
            p.name = "Pico de salida"; p.symbol = "pico"; p.unit = "dBFS";
            p.hints = kParameterIsOutput;
            p.ranges.min = -120.0f; p.ranges.max = 6.0f; p.ranges.def = -120.0f;
            break;
        case pReduccion:
            p.name = "Reduccion del limitador"; p.symbol = "reduccion"; p.unit = "dB";
            p.hints = kParameterIsOutput;
            p.ranges.min = -40.0f; p.ranges.max = 0.0f; p.ranges.def = 0.0f;
            break;
        case pLatencia:
            p.name = "Latencia"; p.symbol = "latencia"; p.unit = "ms";
            p.hints = kParameterIsOutput;
            p.ranges.min = 0.0f; p.ranges.max = 500.0f; p.ranges.def = 0.0f;
            break;
        case pEstado: {
            p.name = "Estado"; p.symbol = "estado";
            p.hints = kParameterIsOutput | kParameterIsInteger;
            p.ranges.min = 0; p.ranges.max = 1; p.ranges.def = 0;
            static ParameterEnumerationValue v[2] = {
                {0.0f, "OK"}, {1.0f, "Frecuencia no soportada: solo -12 dB, sin correccion"}};
            p.enumValues.count = 2; p.enumValues.restrictedMode = true; p.enumValues.values = v;
            p.enumValues.deleteLater = false;
            break; }
        }
    }

    float getParameterValue(uint32_t index) const override {
        switch (index) {
        case pFiltro: return filtro_;
        case pFase: return fase_;
        case pBypass: return bypass_;
        case pLimitador: return limitador_;
        case pRecorte: return recorte_;
        case pPico: return pico_;
        case pReduccion: return reduccion_;
        case pLatencia: return latenciaMs_;
        case pEstado: return core_.supported() ? 0.0f : 1.0f;
        }
        return 0.0f;
    }

    void setParameterValue(uint32_t index, float v) override {
        switch (index) {
        case pFiltro: filtro_ = v > 0.5f ? 1.0f : 0.0f; core_.setVariant((int)filtro_); break;
        case pFase: fase_ = v > 0.5f ? 1.0f : 0.0f; core_.setPhase((int)fase_); break;
        case pBypass: bypass_ = v > 0.5f ? 1.0f : 0.0f; core_.setBypass(bypass_ > 0.5f); break;
        case pLimitador: limitador_ = v > 0.5f ? 1.0f : 0.0f; core_.setLimiter(limitador_ > 0.5f); break;
        case pRecorte: recorte_ = v; core_.setTrimDb(v); break;
        }
    }

    void sampleRateChanged(double fs) override { core_.prepare(fs); reportLatency(); }
    void activate() override { core_.reset(); reportLatency(); }

    void run(const float** inputs, float** outputs, uint32_t frames) override {
        core_.process(inputs[0], inputs[1], outputs[0], outputs[1], frames);
        pico_ = core_.takePeakDb();
        reduccion_ = core_.takeGainReductionDb();
        reportLatency();
    }

private:
    void reportLatency() {
        const uint32_t lat = (uint32_t)core_.latencySamples();
        if (lat != lastLatency_) { lastLatency_ = lat; setLatency(lat); }
        latenciaMs_ = 1000.0f * (float)lat / (float)getSampleRate();
    }

    kh::Corrector core_;
    float filtro_ = 0, fase_ = 0, bypass_ = 0, limitador_ = 1, recorte_ = 0;
    float pico_ = -120, reduccion_ = 0, latenciaMs_ = 0;
    uint32_t lastLatency_ = 0xffffffff;

    DISTRHO_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(KH120ACorrector)
};

Plugin* createPlugin() { return new KH120ACorrector(); }

END_NAMESPACE_DISTRHO
