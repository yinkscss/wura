# Routing

The point of the money agent is not only that you can chat with it. It should also compare rates and give you the best one, then show that rate clearly before you approve.

## The agent's own routing layer

The agent has its own routing layer, built on StellarRoute's routing logic.

[StellarRoute](https://github.com/StellarRoute/StellarRoute) itself is not deployed, so it is not a runtime dependency of this product. The agent does not call a live StellarRoute service and should not be described as if it does. What carries over is the routing approach: look at more than one place, compare, and pick the best path.

That layer compares rates across Stellar venues and returns the winning quote. The pitch can say it compares rates across exchanges and gives the user the best one, because the agent does that work itself.

## Proposed venues

The first venues to compare, proposed and not yet confirmed, are:

- Stellar's built-in exchange (SDEX)
- Soroswap
- Aquarius

This list may change once implementation starts. Until it is confirmed, treat it as a proposed starting set, not a finished integration list.

## What the demo should show

The demo should make the comparison visible, not hide it behind a single number.

Show two or three real sources side by side, with the rate from each, and mark the one the agent picks. Then show that exact rate, the amounts in and out, and any known cost, and wait for the user to approve.

If a venue is down or cannot be quoted, the agent should say so and quote from the venues it can actually reach, rather than invent a comparison.
