import Link from 'next/link'
import Nav from '@/components/Nav'

const CATEGORIES = [
  { icon: 'ð§', name: 'Fridge' }, { icon: 'ð«§', name: 'Washing Machine' },
  { icon: 'ðï¸', name: 'Mattress' }, { icon: 'ðï¸', name: 'Couch/Sofa' },
  { icon: 'ð¥ï¸', name: 'TV / Desk' }, { icon: 'ðª', name: 'Wardrobe' },
  { icon: 'ðª', name: 'Dining Table' }, { icon: 'ð§', name: 'Tools / Gear' },
  { icon: 'ðï¸', name: 'Gym Equipment' }, { icon: 'ð¿', name: 'Garden' },
  { icon: 'ð§±', name: 'Building Materials' }, { icon: 'ð¦', name: 'Other Large Items' },
]

const STEPS = [
  { n: '1', title: 'Post your item', desc: 'Take a photo, select the item type, and enter pickup and dropoff addresses. Done in under 2 minutes.' },
  { n: '2', title: 'Get matched instantly', desc: 'We find the nearest available ute or van driver and assign them your job. You see their name, vehicle, and ETA immediately.' },
  { n: '3', title: 'Track & receive', desc: 'Get notified at every step. Pay cash to the driver on delivery â we charge a small $12 service fee.' },
]

export default function HomePage() {
  return (<div><Nav /></div>)
}
