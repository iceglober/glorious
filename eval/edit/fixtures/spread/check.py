import money, rates, cart, report, sys
fails = []
def eq(name, got, want):
    if got != want: fails.append(f"{name}: got {got!r} want {want!r}")
eq("format_money", money.format_money(1234), "$12.34")
eq("apply_rate", rates.apply_rate(100, 0.25), 75.0)
eq("subtotal", cart.subtotal([1, 2, 3]), 6)
eq("report.top", report.top([5, 1, 9, 3], 2), [9, 5])
print("\n".join(fails) if fails else "ALL PASS")
sys.exit(1 if fails else 0)
