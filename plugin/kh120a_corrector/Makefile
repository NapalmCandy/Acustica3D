#!/usr/bin/make -f
# KH120A Corrector — compilación con DPF
#   Linux:   make
#   Windows: make WINDOWS=true CC=x86_64-w64-mingw32-gcc CXX=x86_64-w64-mingw32-g++
NAME = KH120ACorrector
FILES_DSP = KH120ACorrector.cpp ../pffft/src/pffft.c ../pffft/src/pffft_common.c

DPF_PATH = ../dpf
DPF_TARGET_DIR = ../bin
DPF_BUILD_DIR = ../build/$(NAME)

include ../dpf/Makefile.plugins.mk

BUILD_C_FLAGS   += -I../pffft/include/pffft -I../src -O3 -DPFFFT_STATIC_DEFINE
BUILD_CXX_FLAGS += -I../pffft/include/pffft -I../src -O3 -DPFFFT_STATIC_DEFINE

TARGETS += vst3 clap

all: $(TARGETS)
