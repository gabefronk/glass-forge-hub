/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: '10px',
  			sm: '9px'
  		},
  		colors: {
  			// Glass Forge palette: older screens were written with Tailwind's cool slate/blue
  			// scales. Point those scales at the warm neutrals and teal from src/index.css
  			// so every page reads as one system without touching each class.
  			slate: {
  				50: '#FAF8F3', 100: '#F4F1EA', 200: '#E0DACF', 300: '#D3CABB', 400: '#8A8F93',
  				500: '#616A6D', 600: '#566063', 700: '#34403F', 800: '#1C2627', 900: '#101617', 950: '#0C1F21'
  			},
  			blue: {
  				50: '#EEF5F3', 100: '#E2EEEB', 200: '#C7E4D2', 300: '#9CC9B8', 400: '#4F8C83', 500: '#10524C',
  				600: '#10524C', 700: '#0B3F3B', 800: '#093431', 900: '#082F2C', 950: '#061F1D'
  			},
  			background: 'var(--background)',
  			foreground: 'var(--foreground)',
  			card: {
  				DEFAULT: 'var(--card)',
  				foreground: 'var(--card-foreground)'
  			},
  			popover: {
  				DEFAULT: 'var(--popover)',
  				foreground: 'var(--popover-foreground)'
  			},
  			primary: {
  				DEFAULT: 'var(--primary)',
  				foreground: 'var(--primary-foreground)'
  			},
  			secondary: {
  				DEFAULT: 'var(--secondary)',
  				foreground: 'var(--secondary-foreground)'
  			},
  			muted: {
  				DEFAULT: 'var(--muted)',
  				foreground: 'var(--muted-foreground)'
  			},
  			accent: {
  				DEFAULT: 'var(--accent)',
  				foreground: 'var(--accent-foreground)'
  			},
  			destructive: {
  				DEFAULT: 'var(--destructive)',
  				foreground: 'var(--destructive-foreground)'
  			},
  			border: 'var(--border)',
  			input: 'var(--input)',
  			ring: 'var(--ring)',
  			ready: {
  				DEFAULT: 'var(--ready)',
  				bg: 'var(--ready-bg)',
  				border: 'var(--ready-border)'
  			},
  			review: {
  				DEFAULT: 'var(--review)',
  				bg: 'var(--review-bg)',
  				border: 'var(--review-border)'
  			},
  			error: {
  				DEFAULT: 'var(--error)',
  				bg: 'var(--error-bg)',
  				border: 'var(--error-border)'
  			},
  			scheduled: {
  				DEFAULT: 'var(--scheduled)',
  				bg: 'var(--scheduled-bg)',
  				border: 'var(--scheduled-border)'
  			},
  			chart: {
  				'1': 'var(--chart-1)',
  				'2': 'var(--chart-2)',
  				'3': 'var(--chart-3)',
  				'4': 'var(--chart-4)',
  				'5': 'var(--chart-5)'
  			},
  			sidebar: {
  				DEFAULT: 'var(--sidebar-bg)',
  				foreground: 'var(--sidebar-foreground)',
  				primary: 'var(--sidebar-primary)',
  				'primary-foreground': 'var(--sidebar-primary-foreground)',
  				accent: 'var(--sidebar-accent)',
  				'accent-foreground': 'var(--sidebar-accent-foreground)',
  				border: 'var(--sidebar-border)',
  				ring: 'var(--sidebar-ring)'
  			}
  		},
  		fontFamily: {
  			heading: ['var(--font-heading)'],
  			body: ['var(--font-body)'],
  			display: ['var(--font-display)'],
  			mono: ['var(--font-mono)']
  		},
  		keyframes: {
  			'accordion-down': {
  				from: { height: '0' },
  				to: { height: 'var(--radix-accordion-content-height)' }
  			},
  			'accordion-up': {
  				from: { height: 'var(--radix-accordion-content-height)' },
  				to: { height: '0' }
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}
