// browser shim — no home dir to collapse; tilde() becomes a no-op
export function homedir() {
  return "";
}
