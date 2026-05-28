/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

declare module '*.svg?raw' {
  const content: string;
  export default content;
}

declare module 'qrcode' {
  export function toDataURL(
    text: string,
    options?: {
      width?: number;
      margin?: number;
    },
  ): Promise<string>;
}
