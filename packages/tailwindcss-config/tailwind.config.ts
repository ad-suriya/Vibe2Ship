import type { Config } from 'tailwindcss';

export default {
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Playfair Display"', 'ui-serif', 'Georgia', 'Cambria', '"Times New Roman"', 'Times', 'serif'],
        sans: [
          '"Inter"',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
      colors: {
        ink: '#1A1A1A',
        paper: '#F5F2ED',
        planning: '#2A6B5E',
        panic: '#D14D2A',
        review: '#6B5BD1',
      },
    },
  },
  plugins: [],
} as Omit<Config, 'content'>;
