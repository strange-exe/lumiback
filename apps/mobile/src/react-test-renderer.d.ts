// jest-expo ships react-test-renderer without types; this is the small part the tests use.
// (Adding @types/react-test-renderer would change package.json, an app fingerprint input.)
declare module "react-test-renderer" {
  import type { ElementType, ReactElement } from "react";

  export interface ReactTestInstance {
    type: ElementType | string;
    props: Record<string, unknown>;
    children: (ReactTestInstance | string)[];
    parent: ReactTestInstance | null;
    findAllByType(type: ElementType): ReactTestInstance[];
    /** `deep: false` stops at the outermost match instead of also returning its descendants. */
    findAll(
      predicate: (node: ReactTestInstance) => boolean,
      options?: { deep?: boolean },
    ): ReactTestInstance[];
    /** The one match; throws when there are none or several. */
    find(predicate: (node: ReactTestInstance) => boolean): ReactTestInstance;
  }

  export interface ReactTestRenderer {
    root: ReactTestInstance;
    unmount(): void;
  }

  export function create(element: ReactElement): ReactTestRenderer;
  export function act(callback: () => Promise<void>): Promise<void>;
  export function act(callback: () => void): void;
}
