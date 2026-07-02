import type { MetadataRoute } from 'next'

const SITE_URL = 'https://getvango.com.au'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const routes: { path: string; priority: number; changeFrequency: 'daily' | 'weekly' | 'monthly' }[] = [
    { path: '', priority: 1, changeFrequency: 'daily' },
    { path: '/service-areas', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/faq', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/signup', priority: 0.9, changeFrequency: 'monthly' },
    { path: '/signup?role=buyer', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/signup?role=driver', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/login', priority: 0.5, changeFrequency: 'monthly' },
    { path: '/privacy', priority: 0.3, changeFrequency: 'monthly' },
  ]

  return routes.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }))
}
