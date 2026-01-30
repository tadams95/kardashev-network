---
name: component
description: Create a new React component following Kardashev Network project patterns
disable-model-invocation: true
argument-hint: "<ComponentName>"
---

# Create React Component

Create a new React component named: **$ARGUMENTS**

## Project Patterns

Follow the existing component patterns in `src/components/`:

### File Structure
```
src/components/
├── ComponentName.tsx    # Component file (PascalCase)
```

### Component Template

```tsx
import React from "react";

interface ${COMPONENT_NAME}Props {
  // Define props here
}

export default function ${COMPONENT_NAME}({ ...props }: ${COMPONENT_NAME}Props) {
  return (
    <div className="">
      {/* Component content */}
    </div>
  );
}
```

## Style Guidelines

1. **Tailwind CSS** - Use Tailwind utility classes, no inline styles
2. **Responsive** - Mobile-first approach (`sm:`, `md:`, `lg:` breakpoints)
3. **Dark theme** - Use `bg-black`, `text-gray-200`, `text-white` for dark backgrounds
4. **Consistent spacing** - Use `p-4`, `p-6`, `p-8` for padding; `space-x-*`, `gap-*` for spacing

## Color Palette (from existing components)

- Background: `bg-black`, `bg-white`, `bg-white/5`
- Text: `text-gray-200`, `text-gray-300`, `text-gray-500`, `text-white`
- Accent: `bg-indigo-600`, `hover:bg-indigo-500`
- Borders: `border-gray-700`

## Checklist

- [ ] Create component file in `src/components/`
- [ ] Use TypeScript with proper interface for props
- [ ] Follow existing naming conventions (PascalCase)
- [ ] Add Tailwind classes for styling
- [ ] Export as default
- [ ] Component is responsive
