#!/usr/bin/env bash
# Full verification for the IPR strategy on a machine without MetaEditor.
#   1. compile the pure strategy headers as C++ under the MQL5 shim
#   2. static-check the MT5-only layer (EA + adapters)
#   3. build and run the strategy logic test suite
set -euo pipefail
cd "$(dirname "$0")"
CXXFLAGS="-std=c++17 -Wall -Wextra -Wno-unused-function -include mql5_compat.h"

echo "[1/3] compiling pure strategy headers ..."
g++ $CXXFLAGS -c compile_check.cpp -o /tmp/ipr_compile_check.o
echo "      OK"

echo "[2/3] static-checking the MT5-only layer ..."
python3 static_check.py

echo "[3/3] building and running the test suite ..."
g++ $CXXFLAGS test_ipr.cpp -o /tmp/ipr_tests
/tmp/ipr_tests
