import { Doto, Instrument_Sans } from "next/font/google";

/** Instrument Sans for all UI text, only the three weights the app uses. */
const ui = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ui",
  display: "swap",
});

/** Doto (dot matrix), only for LED figures on a board: never body copy or text under 20 px. */
const dot = Doto({
  subsets: ["latin"],
  weight: "900",
  variable: "--font-dot",
  display: "swap",
});

/** Both fonts' CSS variables, for the html element of the root layout and the global error page. */
export const fontVariables = `${ui.variable} ${dot.variable}`;
