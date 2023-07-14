export default class Clock {
  startup: number;
  timers = new Map<number, Array<() => void>>();

  constructor() {
    this.startup = this.now;

    this.tick();
  }

  get now() {
    return Math.round(new Date().getTime() / 1000);
  }

  get authWindow() {
    return this.now >> 4;
  }

  // basically setInterval
  interval(interval: number, maxIterations?: number) {}

  at(timestamp: number) {
    const promise = new Promise<void>((r) => {
      const arr: Array<() => void> = this.timers.get(timestamp) || [];

      arr.push(r);

      this.timers.set(timestamp, arr);

      // to keep array sorted
      this.timers = new Map([...this.timers.entries()].sort());
    });

    return promise;
  }

  timer(seconds: number) {
    return this.at(this.now + seconds)
  }

  private tick = () => {
    const now = this.now;
    for (const [at, timers] of Array.from(this.timers.entries())) {
      if (at > now) break; // no need to go further, everything beyond lies in the future still

      this.timers.delete(at);

      timers.forEach((t: () => void) => t());
    }

    setTimeout(this.tick, 1000);
  };
}
