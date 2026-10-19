import { Redirect, type Href } from "expo-router";

/** The web's stack follows the browser history, where the plain redirect is the right move. */
export function CloseTo({ href }: { href: Href }) {
  return <Redirect href={href} />;
}
