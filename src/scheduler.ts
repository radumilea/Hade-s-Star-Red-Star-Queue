/**
 * The slice of `setTimeout` the app relies on. Narrower than `typeof setTimeout`
 * so fakes and lazily-resolved defaults stay simple; resolved lazily so fake
 * timers installed after construction still apply.
 */
export type Scheduler = (callback: () => void, ms: number) => NodeJS.Timeout;

export const defaultScheduler: Scheduler = (callback, ms) => setTimeout(callback, ms);
