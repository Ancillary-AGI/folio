import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-[background-color,color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "cad-btn-primary bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "cad-btn-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90",
        // An outline button already draws an edge, so focus turns that edge to
        // the accent and pulls the ring flush against it. The default offset
        // ring would paint a seam of page background between the two and read as
        // a double border.
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-offset-0",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        /*
         * Every size locks the glyph it will hold. A bare lucide icon defaults to
         * 24px, so a size that forgets the lock renders a blob half again as wide
         * as its neighbours — which is exactly how the header ended up with one
         * 24px sun next to a row of 16px icons. Locking it here means a caller
         * passing `<Sun />` can never be wrong, and the ratio of glyph to box
         * stays the same wherever a button appears.
         */
        default: "h-10 px-4 py-2 [&>svg]:h-4 [&>svg]:w-4",
        sm: "h-9 rounded-md px-3 [&>svg]:h-4 [&>svg]:w-4",
        lg: "h-11 rounded-md px-8 [&>svg]:h-5 [&>svg]:w-5",
        icon: "h-10 w-10 rounded-md p-0 [&>svg]:h-4 [&>svg]:w-4",
        /*
         * The chrome scale: 28px, the same box as `.cad-ctl`, so a header button
         * and the tab strip, HUD and floating palettes beside it share one centre
         * line. The glyph lock belongs to the size, not to a class each caller
         * remembers to pass: a 16px icon in a 28px box reads as clipped, and a row
         * of 14px icons next to a row of 16px ones reads as misaligned. Callers
         * pass the icon bare. `icon`/`default`/`sm` stay for dialogs and forms,
         * where a control sits alone and a larger target is the point.
         */
        bar: "h-7 gap-1.5 rounded-md px-2 text-[11px] [&>svg]:h-3.5 [&>svg]:w-3.5",
        "bar-icon": "h-7 w-7 rounded-md p-0 [&>svg]:h-3.5 [&>svg]:w-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  // asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

/*
 * Only components are exported from this module: exporting the `cva` recipe as
 * well would defeat React Fast Refresh for every file that imports a Button.
 * Component styling lives in `buttonVariants`; component API lives in the props
 * interface. Add a variant there rather than reaching for a one-off class.
 */
export { Button }