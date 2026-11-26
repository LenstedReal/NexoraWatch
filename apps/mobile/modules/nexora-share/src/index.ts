// JS side of the local "NexoraShare" module. On iOS, in Expo Go or in a build without the module this is null and
// moveToBack() does nothing (the person then goes back with the Back button).
import { requireOptionalNativeModule } from "expo-modules-core";

type NexoraShareNative = { moveToBack(): boolean };

export const NexoraShare = requireOptionalNativeModule<NexoraShareNative>("NexoraShare");

/** Puts Nexora behind the app the person shared from. False when it could not. */
export function moveToBack(): boolean {
  try {
    return NexoraShare?.moveToBack() === true;
  } catch {
    return false;
  }
}
