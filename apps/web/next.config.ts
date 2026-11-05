import type { NextConfig } from "next";

import { SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
