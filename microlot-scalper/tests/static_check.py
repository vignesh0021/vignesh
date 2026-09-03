#!/usr/bin/env python3
"""Static checks for the MQL5-only layer (EA + MT5 adapters).

g++ compiles the pure strategy headers under mql5_compat.h, but the files
that call the terminal API cannot be compiled here. This script catches the
classes of error that would otherwise only surface in MetaEditor:

  1. unresolved #include targets
  2. unbalanced braces / parens / brackets
  3. calls to Ipr* free functions that are never defined
  4. method and member accesses on the EA's globals that do not exist
  5. enum values missing from the name-mapping switches
  6. use of MQL5 reserved identifiers as our own names
"""
import re, sys, os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INC  = ROOT / "MQL5" / "Include" / "IPR"
EA   = ROOT / "MQL5" / "Experts" / "IPR" / "IPR_Scalper.mq5"

errors, warnings = [], []

def strip_code(text):
    """Remove comments and string literals so they can't produce false hits."""
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    text = re.sub(r'//[^\n]*', '', text)
    text = re.sub(r'"(?:[^"\\]|\\.)*"', '""', text)
    text = re.sub(r"'(?:[^'\\]|\\.)*'", "''", text)
    return text

files = sorted(INC.glob("*.mqh")) + [EA]
src   = {f: f.read_text() for f in files}
code  = {f: strip_code(t) for f, t in src.items()}

# ---- 1. include resolution -------------------------------------------------
for f, t in code.items():
    for m in re.finditer(r'#include\s+([<"])([^>"]+)[>"]', t):
        kind, target = m.group(1), m.group(2)
        cand = (INC / Path(target).name) if kind == '<' else (f.parent / target)
        if not cand.exists():
            errors.append(f"{f.name}: unresolved #include {kind}{target}")

# ---- 2. bracket balance ----------------------------------------------------
for f, t in code.items():
    for open_c, close_c, label in (('{','}','braces'), ('(',')','parens'), ('[',']','brackets')):
        d = t.count(open_c) - t.count(close_c)
        if d:
            errors.append(f"{f.name}: unbalanced {label} (delta {d:+d})")

# ---- 3. Ipr* free functions ------------------------------------------------
defined = set()
for f, t in code.items():
    # definitions look like:  <type> IprName(   at the start of a line
    for m in re.finditer(r'^\s*(?:static\s+|virtual\s+)?[A-Za-z_][\w:\*&\s]*?\b(Ipr[A-Za-z0-9_]*)\s*\(', t, re.M):
        defined.add(m.group(1))
    # struct/class members and macros
for f, t in code.items():
    for m in re.finditer(r'#define\s+(IPR_[A-Z0-9_]*)\s*\(', t):
        defined.add(m.group(1))

# things that are types/enums/structs, not calls
type_names = set()
for f, t in code.items():
    for m in re.finditer(r'\b(?:struct|class|enum)\s+([A-Za-z_]\w*)', t):
        type_names.add(m.group(1))

called = {}
for f, t in code.items():
    for m in re.finditer(r'\b(Ipr[A-Za-z0-9_]*)\s*\(', t):
        called.setdefault(m.group(1), set()).add(f.name)

for name, where in sorted(called.items()):
    if name in defined or name in type_names:
        continue
    errors.append(f"unresolved Ipr* call '{name}' used in: {', '.join(sorted(where))}")

# ---- 4. members/methods on the EA globals ----------------------------------
def members_of(block):
    """Method names and m_ members declared inside a struct/class body."""
    names = set()
    for m in re.finditer(r'\b([A-Za-z_]\w*)\s*\([^;{]*\)\s*(?:const\s*)?\{', block):
        names.add(m.group(1))
    for m in re.finditer(r'\b([A-Za-z_]\w*)\s*\([^;)]*\)\s*(?:const\s*)?;', block):
        names.add(m.group(1))
    for m in re.finditer(r'\b(m_[A-Za-z0-9_]*)\b', block):
        names.add(m.group(1))
    # plain field declarations:  <type> name;   /  <type> name[N];
    for m in re.finditer(r'^\s*(?:const\s+)?[A-Za-z_]\w*\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*;',
                         block, re.M):
        names.add(m.group(1))
    return names

def body_of(typename):
    for f, t in code.items():
        m = re.search(r'\b(?:struct|class)\s+' + typename + r'\b', t)
        if not m:
            continue
        i = t.index('{', m.end()); depth = 0
        for j in range(i, len(t)):
            if t[j] == '{': depth += 1
            elif t[j] == '}':
                depth -= 1
                if depth == 0:
                    return t[i:j+1]
    return None

globals_map = {
    'g_log': 'CIprLogger', 'g_broker': 'CIprBroker', 'g_md': 'CIprMarketData',
    'g_state': 'CIprStateStore', 'g_machine': 'IprSetupMachine',
    'g_risk': 'IprRiskManager', 'g_cfg': 'IprConfig', 'g_spec': 'IprSymbolSpec',
    'g_trade': 'IprTradeState',
}
bodies = {g: body_of(tn) for g, tn in globals_map.items()}
for g, tn in globals_map.items():
    if bodies[g] is None:
        errors.append(f"type {tn} for global {g} not found")

ea = code[EA]
for m in re.finditer(r'\b(g_[a-z_]+)\.([A-Za-z_]\w*)', ea):
    gname, member = m.group(1), m.group(2)
    if gname not in globals_map or bodies.get(gname) is None:
        continue
    if member not in members_of(bodies[gname]):
        errors.append(f"{EA.name}: {gname}.{member} not declared in {globals_map[gname]}")

# nested access such as g_machine.m_cluster.RecordEntry / g_machine.m_active.dTp
nested = {'m_cluster': 'IprClusterState', 'm_active': 'IprSetup',
          'm_consumed': 'IprConsumedRing'}
for m in re.finditer(r'\bg_machine\.(m_\w+)\.([A-Za-z_]\w*)', ea):
    outer, inner = m.group(1), m.group(2)
    tn = nested.get(outer)
    if not tn:
        continue
    b = body_of(tn)
    if b is None:
        errors.append(f"nested type {tn} not found"); continue
    fields = members_of(b) | set(re.findall(r'\b([a-zA-Z_]\w*)\s*(?:\[[^\]]*\])?\s*;', b))
    if inner not in fields:
        errors.append(f"{EA.name}: g_machine.{outer}.{inner} not declared in {tn}")

# ---- 5. enum coverage in the name switches ---------------------------------
def extract_fn(text, fn):
    """Body of a free function, located by brace matching."""
    m = re.search(r'\b' + fn + r'\s*\(', text)
    if not m:
        return ''
    i = text.find('{', m.end())
    if i < 0:
        return ''
    depth = 0
    for j in range(i, len(text)):
        if text[j] == '{': depth += 1
        elif text[j] == '}':
            depth -= 1
            if depth == 0:
                return text[i:j+1]
    return ''

def enum_values(name):
    for f, t in code.items():
        m = re.search(r'enum\s+' + name + r'\s*\{(.*?)\}', t, re.S)
        if m:
            vals = []
            for line in m.group(1).split(','):
                line = line.strip()
                if not line: continue
                vals.append(line.split('=')[0].strip())
            return [v for v in vals if v]
    return []

logger = code[INC / 'Logger.mqh']
for enum_name, fn in (('IprReject', 'IprRejectName'), ('IprExitReason', 'IprExitName')):
    vals = enum_values(enum_name)
    if not vals:
        errors.append(f"enum {enum_name} not found"); continue
    block = extract_fn(logger, fn)
    for v in vals:
        if v not in block:
            errors.append(f"Logger.mqh: {fn}() does not handle {enum_name}::{v}")

# ---- 6. MQL5 reserved identifiers used as our own names --------------------
RESERVED = {'Bars','Point','Digits','Symbol','Period','Ask','Bid','Volume','Time',
            'High','Low','Open','Close','Print','Alert','Comment','OrderSend'}
for f, t in code.items():
    for m in re.finditer(r'\b(?:struct|class|enum)\s+([A-Za-z_]\w*)', t):
        if m.group(1) in RESERVED:
            errors.append(f"{f.name}: type name '{m.group(1)}' collides with an MQL5 built-in")

# ---- report ----------------------------------------------------------------
print(f"static_check: {len(files)} files "
      f"({sum(len(t.splitlines()) for t in src.values())} lines)")
for w in warnings: print("  WARN :", w)
for e in errors:   print("  ERROR:", e)
print(f"static_check: {len(errors)} error(s), {len(warnings)} warning(s)")
sys.exit(1 if errors else 0)
