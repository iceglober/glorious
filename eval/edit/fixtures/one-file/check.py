import calc, sys
fails = []
def eq(name, got, want):
    if got != want: fails.append(f"{name}: got {got!r} want {want!r}")
eq("total", calc.total([1, 2, 3]), 6)
eq("average", calc.average([2, 4]), 3)
eq("discount", calc.discount(100, 0.25), 75.0)
eq("clamp", calc.clamp(15, 0, 10), 10)
eq("top_n", calc.top_n([5, 1, 9, 3], 2), [9, 5])
print("\n".join(fails) if fails else "ALL PASS")
sys.exit(1 if fails else 0)
