/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#24326B",
          50: "#EEF0F7",
          100: "#D7DCEC",
          200: "#AFB9D9",
          300: "#8796C6",
          400: "#5F73B3",
          500: "#3D4D8F",
          600: "#24326B",
          700: "#1E2752",
          800: "#161C3D",
          900: "#0D1128",
        },
        lime: {
          DEFAULT: "#CEE177",
          50: "#F7FAEC",
          100: "#EDF3D2",
          200: "#DEEAA6",
          300: "#CEE177",
          400: "#BCD64C",
          500: "#A5BE34",
          600: "#7F9428",
        },
        sky: {
          DEFAULT: "#40B0E5",
          50: "#EBF6FD",
          100: "#95D8FA",
          200: "#9CD3F1",
          300: "#40B0E5",
          400: "#2C97D6",
          500: "#1F7AB3",
        },
      },
      fontFamily: {
        sans: ["Poppins", "system-ui", "sans-serif"],
      },
      borderRadius: {
        pill: "999px",
      },
    },
  },
  plugins: [],
}

