import { BlurTargetView, BlurView } from "expo-blur";
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { AccessibilityInfo, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { useColors } from "@/ui/theme";

/**
 * Smoked glass for the dock. Android blurs only what sits inside a BlurTargetView, and the glass
 * must stay outside its own target, so each tab's scene is wrapped in one (SceneTarget, set as the
 * tabs' screenLayout) while the dock is drawn by the tab bar beside the scenes. The dock blurs the
 * active tab's scene. Below Android 12 there is no blur: the fill alone, which is dark enough on
 * its own (85% of the dock colour).
 */

/** One target per tab scene, by route key: the same object every time, so React keeps it. */
const targets = new Map<string, RefObject<View | null>>();

export function sceneTarget(routeKey: string): RefObject<View | null> {
  let target = targets.get(routeKey);
  if (!target) {
    target = { current: null };
    targets.set(routeKey, target);
  }
  return target;
}

/** A tab's scene, inside the view the dock's glass blurs. Painted with the page colour. */
export function SceneTarget({
  routeKey,
  children,
}: {
  routeKey: string;
  children: ReactNode;
}): ReactNode {
  const c = useColors();
  return (
    <BlurTargetView ref={sceneTarget(routeKey)} style={{ flex: 1, backgroundColor: c.page }}>
      {children}
    </BlurTargetView>
  );
}

/** iOS "Reduce transparency" (Android has no such setting, so this stays false there). */
function useReduceTransparency(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then((value) => {
        if (live) setReduce(value);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setReduce);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/**
 * A rounded glass surface: blur of the target, the dock colour over it at 85%, and a light 1 px
 * edge. With reduced transparency it is the plain, opaque dock colour.
 */
export function Glass({
  target,
  radius,
  style,
  children,
}: {
  target: RefObject<View | null>;
  radius: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}): ReactNode {
  const c = useColors();
  const solid = useReduceTransparency();
  const shape = { borderRadius: radius, borderCurve: "continuous" } as const;
  return (
    <View style={[style, shape, { boxShadow: "0 10px 30px rgba(11, 12, 16, 0.28)" }]}>
      {/* The blur ignores its own borderRadius, so a clipping view gives it the shape. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, shape, { overflow: "hidden" }]}>
        {solid ? null : (
          <BlurView
            blurTarget={target}
            blurMethod="dimezisBlurViewSdk31Plus"
            tint="dark"
            intensity={60}
            style={StyleSheet.absoluteFill}
          />
        )}
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: solid ? c.dock : c.dockGlass }]}
        />
        <View
          style={[StyleSheet.absoluteFill, shape, { borderWidth: 1, borderColor: c.glassLine }]}
        />
      </View>
      {children}
    </View>
  );
}
