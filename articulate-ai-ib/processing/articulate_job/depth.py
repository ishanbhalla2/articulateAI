"""Analysis depth levels (build spec section 4.4)."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Depth:
    level: int
    name: str
    min_quotes: int
    max_quotes: int
    include_metrics: bool
    self_check: bool
    review_pass: bool
    reconcile_judges: bool
    frame_count: int
    frame_width: int


DEPTHS = {
    1: Depth(1, "Quick", 1, 1, False, False, False, False, 0, 0),
    2: Depth(2, "Light", 1, 1, True, False, False, False, 0, 0),
    3: Depth(3, "Balanced", 2, 2, True, True, False, False, 6, 512),
    4: Depth(4, "Detailed", 2, 3, True, True, True, False, 10, 768),
    5: Depth(5, "Thorough", 3, 3, True, True, True, True, 16, 1024),
}


def depth_for(level: int) -> Depth:
    return DEPTHS.get(int(level), DEPTHS[3])
