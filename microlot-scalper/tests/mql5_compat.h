//+------------------------------------------------------------------+
//| mql5_compat.h - minimal MQL5 runtime shim for the g++ test build.|
//|                                                                  |
//| This is force-included (g++ -include) when compiling the pure    |
//| IPR headers as C++. It exists ONLY so the strategy logic can be  |
//| compiled and executed by a test harness on a machine with no     |
//| MetaEditor. It is never shipped to MT5 and the strategy headers  |
//| contain no #ifdef referring to it -- they stay pure MQL5.        |
//|                                                                  |
//| Every function here mirrors the MQL5 built-in of the same name.  |
//+------------------------------------------------------------------+
#ifndef MQL5_COMPAT_H
#define MQL5_COMPAT_H

#include <string>
#include <cmath>
#include <cstdio>
#include <cstdarg>
#include <cstdint>
#include <sys/types.h>   // glibc already provides ulong / uint / ushort

typedef std::string        string;
typedef unsigned char      uchar;
typedef long long          datetime;

// The strategy headers use MQL5's `long` (64-bit signed) and `ulong`
// (64-bit unsigned) directly. Both match on Linux x86-64, which is what
// makes the dual MQL5/C++ compilation of the pure layer sound.
static_assert(sizeof(long) == 8,  "IPR assumes 64-bit long, as in MQL5");
static_assert(sizeof(ulong) == 8, "IPR assumes 64-bit ulong, as in MQL5");

inline double MathAbs(double v)              { return std::fabs(v); }
inline double MathMax(double a, double b)    { return (a > b) ? a : b; }
inline double MathMin(double a, double b)    { return (a < b) ? a : b; }
inline int    MathMax(int a, int b)          { return (a > b) ? a : b; }
inline int    MathMin(int a, int b)          { return (a < b) ? a : b; }
inline double MathRound(double v)            { return std::floor(v + 0.5); }
inline double MathFloor(double v)            { return std::floor(v); }
inline double MathCeil(double v)             { return std::ceil(v); }
inline double MathSqrt(double v)             { return std::sqrt(v); }
inline double MathPow(double a, double b)    { return std::pow(a, b); }
inline double MathMod(double a, double b)    { return std::fmod(a, b); }

inline double NormalizeDouble(double v, int digits)
  {
   double p = std::pow(10.0, (double)digits);
   // MQL5 rounds half away from zero.
   return (v >= 0.0) ? std::floor(v * p + 0.5) / p : std::ceil(v * p - 0.5) / p;
  }

inline int    StringLen(const string &s)                  { return (int)s.size(); }
inline ushort StringGetCharacter(const string &s, int i)
  {
   if(i < 0 || i >= (int)s.size())
      return 0;
   return (ushort)(unsigned char)s[i];
  }

inline string StringFormat(const char *fmt, ...)
  {
   char buf[2048];
   va_list ap;
   va_start(ap, fmt);
   vsnprintf(buf, sizeof(buf), fmt, ap);
   va_end(ap);
   return string(buf);
  }

inline void Print(const string &s) { std::printf("%s\n", s.c_str()); }

#endif // MQL5_COMPAT_H
