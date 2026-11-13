"""Two independent operations at a time; stop admission on the first failure."""

from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait


def run_independent(items, operation):
    remaining = iter(items)
    with ThreadPoolExecutor(max_workers=2) as pool:
        active = {
            pool.submit(operation, item) for item in [next(remaining, None), next(remaining, None)] if item is not None
        }
        while active:
            done, active = wait(active, return_when=FIRST_COMPLETED)
            # Check the complete finished group before admitting more work.
            for future in done:
                future.result()
            for _ in done:
                item = next(remaining, None)
                if item is not None:
                    active.add(pool.submit(operation, item))
