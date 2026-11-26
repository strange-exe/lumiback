import { createElement, type ReactElement } from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { setPrefs } from "@/lib/prefs";
import { Button, chipColours, Field, Row, Section, StatusChip } from "@/ui/kit";
import { palettes } from "@/ui/theme";

jest.mock("@expo/vector-icons/Ionicons", () => () => null);
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

let tree: ReactTestRenderer | undefined;

async function render(element: ReactElement): Promise<ReactTestInstance> {
  await act(async () => {
    tree = create(element);
  });
  return tree!.root;
}

const flat = (node: ReactTestInstance): ViewStyle =>
  (StyleSheet.flatten(node.props.style as ViewStyle) ?? {}) as ViewStyle;

const textColour = (root: ReactTestInstance, words: string): unknown =>
  (
    StyleSheet.flatten(
      root.find((n) => n.type === Text && n.props.children === words).props.style as TextStyle,
    ) ?? {}
  ).color;

beforeEach(() => {
  // Press's spring waits for this answer; never giving one keeps animations out of these tests.
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockReturnValue(new Promise<boolean>(() => undefined));
});

afterEach(async () => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.restoreAllMocks();
  await act(async () => setPrefs({ theme: "gate" }));
});

const THEMES = ["gate", "led", "dusk"] as const;

describe("role tokens in the kit", () => {
  it("writes secondary and quiet buttons in the link colour, in every theme", async () => {
    for (const theme of THEMES) {
      await act(async () => setPrefs({ theme }));
      const c = palettes[`${theme}/light`];
      const root = await render(
        createElement(View, null, [
          createElement(Button, {
            key: 1,
            label: "Copy",
            variant: "secondary",
            onPress: jest.fn(),
          }),
          createElement(Button, { key: 2, label: "Cancel", variant: "quiet", onPress: jest.fn() }),
          createElement(Button, { key: 3, label: "I'm back", onPress: jest.fn() }),
        ]),
      );
      expect(textColour(root, "Copy")).toBe(c.link);
      expect(textColour(root, "Cancel")).toBe(c.link);
      expect(textColour(root, "I'm back")).toBe(c.onAccent);
      act(() => tree?.unmount());
    }
  });

  it("marks a focused field, its caret and its selection with the focus colour", async () => {
    await act(async () => setPrefs({ theme: "dusk" }));
    const c = palettes["dusk/light"];
    const root = await render(createElement(Field, { label: "Where to?" }));
    const input = root.findAllByType(TextInput)[0]!;
    expect(input.props.cursorColor).toBe(c.focus);
    expect(input.props.selectionHandleColor).toBe(c.focus);
    expect(String(input.props.selectionColor).startsWith(c.focus)).toBe(true);
    // The box around the input: the field's one View with a 52 dp minimum height.
    const box = (): ReactTestInstance =>
      root.find((n) => n.type === View && flat(n).minHeight === 52);
    expect(flat(box()).borderColor).toBe(c.field);
    act(() => (input.props.onFocus as (e: unknown) => void)({}));
    expect(flat(box()).borderColor).toBe(c.focus);
  });

  it("gives the Out chip its own out colours, apart from the accent", async () => {
    for (const theme of THEMES) {
      await act(async () => setPrefs({ theme }));
      const c = palettes[`${theme}/light`];
      const root = await render(createElement(StatusChip, { label: "Out", tone: "out" }));
      expect(textColour(root, "Out")).toBe(c.outText);
      const chip = root.find((n) => n.type === View && flat(n).backgroundColor !== undefined);
      expect(flat(chip).backgroundColor).toBe(c.outSoft);
      act(() => tree?.unmount());
    }
  });

  it("lets a row be a radio button that says whether it's chosen", async () => {
    const root = await render(
      createElement(Row, {
        title: "Dusk",
        onPress: jest.fn(),
        accessibilityRole: "radio",
        selected: true,
      }),
    );
    // The pressable that reaches Android's accessibility tree (the outermost element with an
    // accessibility state), not the Row element around it.
    const [radio, ...more] = root.findAll(
      (n) => n.props.accessibilityRole === "radio" && n.props.accessibilityState !== undefined,
      { deep: false },
    );
    expect(more).toHaveLength(0);
    expect(radio!.props.onPress).toEqual(expect.any(Function));
    expect(radio!.props.accessibilityState).toEqual({ checked: true });
  });

  it("names a section of radio rows as one radio group", async () => {
    const rows = ["Gate glass", "Dusk"].map((title) =>
      createElement(Row, { key: title, title, onPress: jest.fn(), accessibilityRole: "radio" }),
    );
    // (Section's props type wants children among the props; they're passed as arguments here.)
    type SectionProps = Parameters<typeof Section>[0];
    const root = await render(
      createElement(Section, { title: "Colour theme", radiogroup: true } as SectionProps, rows),
    );
    const groups = root.findAll((n) => n.props.accessibilityRole === "radiogroup", {
      deep: false,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.props.accessibilityLabel).toBe("Colour theme");
    const inside = groups[0]!.findAll(
      (n) => n.props.accessibilityRole === "radio" && n.props.accessibilityState !== undefined,
      { deep: false },
    );
    expect(inside).toHaveLength(2);
    // A plain section stays a plain group of rows.
    act(() => tree?.unmount());
    const plain = await render(createElement(Section, { title: "Account" } as SectionProps, rows));
    expect(plain.findAll((n) => n.props.accessibilityRole === "radiogroup")).toHaveLength(0);
  });
});

/** WCAG contrast of two #rrggbb colours. */
function ratio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("status chips", () => {
  const TONES = ["good", "danger", "accent", "muted"] as const;

  it("keep the out colours for Out alone, with readable words, in all six palettes", () => {
    const clashes: string[] = [];
    const faint: string[] = [];
    for (const [name, c] of Object.entries(palettes)) {
      const [outFill] = chipColours(c, "out");
      expect(chipColours(c, "out")).toEqual([c.outSoft, c.outText]);
      for (const tone of TONES) {
        const [fill, words] = chipColours(c, tone);
        // Teal in Gate glass (orange in LED night) means "out": no other chip is filled with it.
        if (fill === outFill) clashes.push(`${name} ${tone}`);
        if (ratio(words, fill) < 4.5) faint.push(`${name} ${tone}`);
      }
    }
    expect(clashes).toEqual([]);
    expect(faint).toEqual([]);
  });

  it("draws an accent chip (Waiting, a staff role) apart from the Out chip beside it", async () => {
    const c = palettes["gate/light"];
    const root = await render(createElement(StatusChip, { label: "Warden", tone: "accent" }));
    const chip = root.find((n) => n.type === View && flat(n).backgroundColor !== undefined);
    expect(flat(chip).backgroundColor).not.toBe(c.outSoft);
    expect(flat(chip).backgroundColor).toBe(chipColours(c, "accent")[0]);
    expect(textColour(root, "Warden")).toBe(chipColours(c, "accent")[1]);
  });
});

describe("button icons", () => {
  const iconColour = (root: ReactTestInstance, name: string): unknown =>
    root.find((n) => n.props.name === name && typeof n.type === "function").props.color;

  it("take the button's own word colour, so an icon never drifts from its label", async () => {
    for (const theme of THEMES) {
      await act(async () => setPrefs({ theme }));
      const c = palettes[`${theme}/light`];
      const root = await render(
        createElement(View, null, [
          createElement(Button, {
            key: 1,
            label: "Copy code",
            variant: "secondary",
            icon: "copy-outline",
            onPress: jest.fn(),
          }),
          createElement(Button, {
            key: 2,
            label: "Send on WhatsApp",
            icon: "logo-whatsapp",
            iconSize: 20,
            onPress: jest.fn(),
          }),
          createElement(Button, {
            key: 3,
            label: "I need help",
            variant: "danger",
            icon: "alert-circle",
            onPress: jest.fn(),
          }),
        ]),
      );
      expect(iconColour(root, "copy-outline")).toBe(c.link);
      expect(iconColour(root, "logo-whatsapp")).toBe(c.onAccent);
      expect(iconColour(root, "alert-circle")).toBe(c.surface);
      expect(root.find((n) => n.props.name === "logo-whatsapp").props.size).toBe(20);
      expect(root.find((n) => n.props.name === "copy-outline").props.size).toBe(18);
      act(() => tree?.unmount());
    }
  });
});
