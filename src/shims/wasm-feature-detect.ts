/** Minimal shim: @jsquash/avif only needs `threads` — always false so the single-thread encoder is used at runtime (Designer iframe / no worker path). */
export async function threads(): Promise<boolean> {
  return false;
}
