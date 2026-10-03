// At most one send per `intervalMs`, and the LATEST value is always sent at the end of an
// interval — so a courier who stops moving never leaves the customer's pin on a stale point.
export function trailingThrottle<T>(send: (value: T) => void, intervalMs: number) {
  let last = 0;
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (!pending) return;
    last = Date.now();
    const { value } = pending;
    pending = null;
    send(value);
  };

  return {
    push(value: T) {
      pending = { value };
      const wait = intervalMs - (Date.now() - last);
      if (wait <= 0) flush();
      else if (!timer) timer = setTimeout(flush, wait);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
