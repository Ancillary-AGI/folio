/**
 * Avatar for a local profile. The standalone build has no image server, so
 * the avatar is drawn locally from the name — symmetric identicon, rounded
 * square, deterministic per name. Works identically in every viewer (it is
 * inline SVG), including screenshots and the admin tables.
 */
import { identicon, identiconCells } from '../lib/identicon'

interface AvatarProps {
  name: string
  /** Rendered size in pixels. The SVG scales, so any number works. */
  size?: number
  className?: string
}

export default function Avatar({ name, size = 40, className }: AvatarProps) {
  const { background, ink, cells } = identicon(name)
  const painted = identiconCells(cells)
  return (
    <svg
      viewBox="0 0 5 5"
      width={size}
      height={size}
      role="img"
      aria-label={`${name}'s avatar`}
      className={className}
      style={{ display: 'block', borderRadius: '28%' }}
    >
      <rect width={5} height={5} fill={background} rx={1.4} />
      {painted.map((cell, index) => (
        <rect key={index} x={cell.x} y={cell.y} width={1} height={1} fill={ink} />
      ))}
    </svg>
  )
}
