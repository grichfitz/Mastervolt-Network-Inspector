import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          950: "#070d18",
          900: "#0c1526",
          800: "#12213a"
        }
      }
    }
  },
  plugins: []
};

export default config;
