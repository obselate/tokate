import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DOMAIN = {"Contributions", "Policy", "Publication"}
ALLOWED = {
    "Cli": DOMAIN | {"Cli", "Execution", "GitHub", "Json", "root"},
    "Execution": {"Execution", "GitHub", "Json", "root"},
    "GitHub": {"GitHub", "root"},
    "Json": {"Json", "root"},
}
for layer in DOMAIN:
    ALLOWED[layer] = DOMAIN | {"Execution", "GitHub", "Json", "root"}

LITERALS = re.compile(r'//[^\n]*|/\*.*?\*/|""".*?"""|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', re.S)
TOKENS = re.compile(r'[A-Za-z_][A-Za-z_0-9]*|[^\s]')
DECLARATIONS = {"class", "struct", "interface", "enum", "delegate"}
NAMES = DECLARATIONS | {"func", "prop", "var", "let", "const"}


def layer_of(path):
    relative = path.relative_to(ROOT / "src")
    return relative.parts[0] if len(relative.parts) > 1 else "root"


sources = {}
types = {}
for path in sorted((ROOT / "src").rglob("*.gs")):
    source = LITERALS.sub(lambda match: re.sub(r"[^\n]", " ", match[0]), path.read_text())
    tokens = list(TOKENS.finditer(source))
    layer = layer_of(path)
    sources[path] = (source, tokens, layer)
    for previous, token in zip(tokens, tokens[1:]):
        if previous[0] in DECLARATIONS:
            types.setdefault(token[0], set()).add(layer)

failed = False
for path, (source, tokens, layer) in sources.items():
    if layer == "root":
        continue
    if layer not in ALLOWED:
        print(f"{path.relative_to(ROOT)}: unknown source layer {layer}", file=sys.stderr)
        failed = True
        continue
    for index, token in enumerate(tokens):
        name = token[0]
        if name not in types or types[name] <= ALLOWED[layer]:
            continue
        previous = tokens[index - 1][0] if index else ""
        following = tokens[index + 1][0] if index + 1 < len(tokens) else ""
        if previous in NAMES or (following == ":" and previous in {"(", "{", ","}):
            continue
        if previous == "." and (index < 2 or tokens[index - 2][0] != "Tokate"):
            continue
        line = source.count("\n", 0, token.start()) + 1
        forbidden = ", ".join(sorted(types[name] - ALLOWED[layer]))
        print(f"{path.relative_to(ROOT)}:{line}: {layer} references {forbidden} type {name}", file=sys.stderr)
        failed = True

sys.exit(1 if failed else 0)
