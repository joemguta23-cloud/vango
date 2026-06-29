import Link from 'next/link'
import Nav from '@/components/Nav'

const CATEGORIES = [
  { icon: '🧊', name: 'Fridge' }, { icon: '🫧', name: 'Washing Machine' },
  { icon: '🛏️', name: 'Mattress' }, { icon: '🛋️', name: 'Couch/Sofa' },
  { icon: '🖥️', name: 'TV / Desk' }, { icon: '🚪', name: 'Wardrobe' },
  { icon: '🪑', name: 'Dining Table' }, { icon: '🔧', name: 'Tools / Gear' },
  { icon: '🏋️', name: 'Gym Equipment' }, { icon: '🌿', name: 'Garden' },
  { icon: '🧱', name: 'Building Materials' }, { icon: '📦', name: 'Other Large Items' },
]

const STEPS = [
  { n: '1', title: 'Post your item', desc: 'Take a photo, select the item type, and enter pickup and dropoff addresses. Done in under 2 minutes.' },
  { n: '2', title: 'Get matched instantly', desc: 'We find the nearest available ute or van driver and assign them your job. You see their name, vehicle, and ETA immediately.' },
  { n: '3', title: 'Track & receive', desc: 'Get notified at every step. Pay cash to the driver on delivery — we charge a small $12 service fee.' },
]

export default function HomePage() {
  return (<div><Nav /></div>)
}
