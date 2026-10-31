import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "../../lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted shadow-[inset_0_0_0_1px_hsl(var(--border))]">
      <SliderPrimitive.Range className="absolute h-full bg-gradient-to-r from-info to-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-[18px] w-[18px] rounded-full border-2 border-primary bg-background shadow-[0_1px_3px_hsl(var(--shadow-color)/0.4)] ring-offset-background transition-[transform,box-shadow] hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[1.18] disabled:pointer-events-none disabled:opacity-45 disabled:border-muted-foreground" />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }