const PLATFORM_LABELS: Record<string, string> = {
  spotify: 'Spotify',
  appleMusic: 'Apple Music',
  bandcamp: 'Bandcamp',
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
  facebook: 'Facebook',
  website: 'Website',
  dragcity: 'Drag City',
}

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform
}
