// jest-expo ships react-test-renderer without types; this is the small part the tests use.
// (Adding @types/react-test-renderer would change package.json, an app fingerprint input.)
declare module "react-test-renderer" {
  import type { ElementType, ReactElement } from "react";

  export interface ReactTestInstance {
    type: ElementType | string;
    props: Record<string, unknown>;
    children: (ReactTestInstance | string)[];
    findAllByType(type: ElementType): ReactTestInstance[];
  }

  export interface ReactTestRenderer {
    root: ReactTestInstance;
    unmount(): void;
  }

  export function create(element: ReactElement): ReactTestRenderer;
  export function act(callback: () => void): void;
}
