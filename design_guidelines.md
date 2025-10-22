# Design Guidelines: AI-Powered Video Calling Platform

## Design Approach
**System Selected**: Material Design 3 with Google Meet/Zoom influences
**Justification**: Video calling platforms require stability, clarity, and performance. Material Design provides the structured component system needed while allowing for modern, clean aesthetics that users expect from professional communication tools.

---

## Core Design Elements

### A. Color Palette

**Light Mode**:
- Primary: 220 90% 56% (vibrant blue for AI/tech feel)
- Primary Variant: 220 85% 48% (darker blue for hover states)
- Surface: 0 0% 100% (pure white)
- Surface Variant: 220 15% 97% (off-white for cards)
- Text Primary: 220 20% 15%
- Text Secondary: 220 10% 45%
- Accent (AI Features): 280 70% 60% (purple for AI indicators)
- Success: 140 65% 45% (green for active states)
- Error: 0 70% 55% (red for disconnect)

**Dark Mode**:
- Primary: 220 85% 65%
- Surface: 220 20% 10%
- Surface Variant: 220 15% 15%
- Text Primary: 0 0% 95%
- Text Secondary: 0 0% 70%

### B. Typography
- **Primary Font**: Inter (Google Fonts) - clean, highly legible for UI
- **Headings**: Font weights 600-700, sizes from text-2xl to text-5xl
- **Body**: Font weight 400, text-sm to text-base
- **Buttons/Labels**: Font weight 500, text-sm
- **Video Overlay Text**: Font weight 600, high contrast with shadows

### C. Layout System
**Spacing Primitives**: Use Tailwind units of **2, 4, 6, 8, 12, 16** for consistency
- Small gaps: gap-2, p-2
- Component padding: p-4, p-6
- Section spacing: p-8, py-12, py-16
- Container max-widths: max-w-7xl for dashboards, max-w-6xl for forms

### D. Component Library

**Navigation**:
- Horizontal navbar: Fixed top, backdrop-blur effect, h-16
- Sidebar (Dashboard): w-64 with icons + labels, collapsible to w-16 icon-only
- Mobile: Hamburger menu with slide-out drawer

**Video Components**:
- Video Grid: CSS Grid with auto-fill, aspect-16/9 tiles
- 1 user: Full screen with controls overlay
- 2 users: 50/50 split
- 3-4 users: 2x2 grid
- 5-6 users: 2x3 grid
- Control Bar: Fixed bottom, glassmorphism effect (backdrop-blur-lg bg-opacity-80)
- Participant Cards: Rounded-lg, relative positioning for overlays

**Cards & Containers**:
- Dashboard Cards: rounded-xl, shadow-sm on light, border on dark
- Call History Items: rounded-lg, hover:bg-surface-variant transition
- User Avatars: Circular, ring-2 for active states

**Buttons**:
- Primary: Filled with primary color, rounded-lg
- Secondary: Outlined, rounded-lg
- Icon Buttons: Circular (rounded-full), p-3, hover:bg-surface-variant
- Video Controls: Large icon buttons (p-4), clear active states
- CTA Buttons: px-8 py-3, text-lg on landing page

**Forms**:
- Input Fields: rounded-lg, p-3, border focus:ring-2
- Face Login Area: Centered card with webcam preview, rounded-xl
- Labels: text-sm font-medium mb-2

**Data Display**:
- Stats Cards: Grid layout, large numbers (text-4xl), icons
- Emotion Detection Overlay: Small badge on video, backdrop-blur
- Attendance List: Avatar + name in compact list
- Chat Messages: Rounded bubbles, sent vs received alignment

**Overlays & Modals**:
- Modal Backdrop: bg-black/50
- Modal Content: max-w-2xl, rounded-2xl, p-8
- Toast Notifications: Fixed top-right, rounded-lg, slide-in animation

### E. Animations
**Use Sparingly**:
- Page Transitions: Fade-in only (duration-200)
- Button Hovers: Scale-105 on primary CTAs only
- Video Grid: Smooth layout shifts (transition-all duration-300)
- Chat Messages: Slide-in for new messages
- NO complex scroll animations or decorative motion

---

## Page-Specific Guidelines

### Landing Page
**Layout**: 
- Hero: 80vh, centered content, gradient background (primary to primary-variant)
- Two-column split: Left text, right 3D illustration/mockup
- Features: 3-column grid (lg:), icon above, title, description
- CTA Section: Centered, large button + secondary action
- Footer: Multi-column with links, social, contact

**Images**:
- Hero Image: Modern 3D video call illustration or screenshot mockup (right side, w-1/2)
- Feature Icons: Use Heroicons (camera, sparkles, chart-bar, etc.)
- NO stock photography

### Dashboard
**Layout**:
- Sidebar + Main Content (grid grid-cols-[256px_1fr])
- Quick Actions: Top row, 4 cards in grid
- Recent Calls: Table/list with 8 spacing
- Activity Graph: Card with chart placeholder

### Video Call Room
**Layout**:
- Full screen video grid
- Controls: Fixed bottom, centered, gap-4 between icon buttons
- Sidebar Chat: w-80, slide-in from right
- Participant List: Absolute top-right, compact
- AI Overlay: Small badges on each video tile

### Post-Call Summary
**Layout**:
- Centered card (max-w-3xl)
- Stats Grid: 2x2 for key metrics
- Detailed List: Attendance, emotions as expandable sections
- Action Buttons: Bottom, flex justify-between

---

## Accessibility & Theming
- Maintain dark mode across ALL components
- Form inputs: Consistent bg-surface-variant in dark mode
- Text contrast: Minimum WCAG AA (4.5:1)
- Focus states: Ring-2 ring-primary on all interactive elements
- Icon-only buttons: Include aria-label

---

## Key Design Principles
1. **Clarity Over Flair**: Video must remain the focus, UI recedes
2. **Performance First**: Minimal shadows, efficient animations
3. **AI Differentiation**: Purple accents for AI features only
4. **Responsive Excellence**: Mobile-first, breakpoints at sm/md/lg/xl
5. **Consistent Spacing**: Stick to the defined spacing units religiously