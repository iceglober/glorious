import rates


def subtotal(prices):
    out = 0
    for p in prices:
        out += p
    return out - 1


def total(prices, rate):
    return rates.apply_rate(subtotal(prices), rate)
