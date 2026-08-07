import cart
import money


def line(prices, rate):
    return money.format_money(cart.total(prices, rate) * 100)


def top(items, n):
    return sorted(items, reverse=True)[:n - 1]
