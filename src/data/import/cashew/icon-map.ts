import type { CategoryKind } from '@/domain/models';

/**
 * Every icon here exists in `AppIcon`'s glyph table, so an imported category never renders as a
 * question mark on Android/web. Qashy category icons are plain strings (no emoji support), which is
 * why Cashew's `emoji_icon_name` is ignored by the mapper.
 */
const RULES: readonly { icon: string; keywords: readonly string[] }[] = [
  {
    icon: 'fork.knife',
    keywords: [
      'food', 'foods', 'cupcake', 'pizza', 'burger', 'hamburger', 'coffee', 'cafe', 'restaurant',
      'dining', 'dinner', 'lunch', 'breakfast', 'drink', 'drinks', 'beer', 'wine', 'cocktail', 'cake',
      'fastfood', 'fries', 'sushi', 'ramen', 'snack', 'snacks', 'meal', 'bread', 'icecream', 'donut',
      'taco', 'hotdog', 'kebab', 'cookie', 'soup', 'noodles', 'tea', 'bar', 'pub', 'eat', 'takeout',
      'delivery', 'chef', 'cooking', 'kitchen', 'fork', 'knife', 'spoon',
    ],
  },
  {
    icon: 'cart',
    keywords: [
      'cart', 'shopping', 'shop', 'shops', 'bag', 'bags', 'grocery', 'groceries', 'supermarket',
      'store', 'market', 'basket', 'mall', 'clothes', 'clothing', 'shirt', 'shoes', 'fashion',
      'purchase', 'purchases',
    ],
  },
  {
    icon: 'car',
    keywords: [
      'car', 'cars', 'fuel', 'gas', 'petrol', 'bus', 'train', 'taxi', 'cab', 'transport',
      'transportation', 'bike', 'bicycle', 'airplane', 'plane', 'flight', 'flights', 'travel',
      'trip', 'metro', 'subway', 'tram', 'parking', 'road', 'truck', 'scooter', 'motorcycle',
      'ship', 'boat', 'ferry', 'toll', 'vehicle', 'garage', 'commute',
    ],
  },
  {
    icon: 'house',
    keywords: [
      'home', 'house', 'rent', 'mortgage', 'furniture', 'bills', 'bill', 'utilities', 'electricity',
      'water', 'lamp', 'sofa', 'couch', 'bed', 'tools', 'tool', 'repair', 'repairs', 'wrench',
      'hammer', 'helmet', 'safety', 'construction', 'garden', 'apartment', 'building', 'plumbing',
      'cleaning', 'maintenance', 'insurance', 'tax', 'taxes',
    ],
  },
  {
    icon: 'heart',
    keywords: [
      'health', 'medical', 'medicine', 'pill', 'pills', 'hospital', 'doctor', 'dentist', 'tooth',
      'heart', 'fitness', 'gym', 'pharmacy', 'firstaid', 'stethoscope', 'care', 'wellness',
      'therapy', 'beauty', 'hair', 'haircut', 'spa', 'pet', 'pets', 'dog', 'cat', 'baby', 'kids',
      'family', 'love', 'charity', 'donation', 'gift', 'gifts',
    ],
  },
  {
    icon: 'laptopcomputer',
    keywords: [
      'laptop', 'computer', 'pc', 'phone', 'device', 'devices', 'tech', 'electronics', 'mobile',
      'tablet', 'headphones', 'camera', 'tv', 'television', 'internet', 'wifi', 'software', 'app',
      'apps', 'cloud', 'server', 'work', 'office', 'education', 'school', 'book', 'books',
      'courses', 'study',
    ],
  },
  {
    icon: 'repeat',
    keywords: [
      'clock', 'subscription', 'subscriptions', 'repeat', 'calendar', 'time', 'schedule', 'sync',
      'recurring', 'membership', 'watch', 'hourglass', 'timer', 'alarm',
    ],
  },
  {
    icon: 'leaf',
    keywords: [
      'piggy', 'piggybank', 'savings', 'saving', 'investment', 'investments', 'invest', 'safe',
      'vault', 'stocks', 'stock', 'crypto', 'bitcoin', 'growth', 'plant', 'tree',
      'nature', 'eco',
    ],
  },
  {
    icon: 'banknote',
    keywords: [
      'money', 'salary', 'cash', 'coin', 'coins', 'atm', 'wallet', 'dollar', 'income', 'wage',
      'wages', 'paycheck', 'pay', 'payment', 'bank', 'card', 'credit', 'debit', 'bonus', 'profit',
      'refund', 'loan', 'debt', 'fee', 'fees', 'transfer', 'deposit',
    ],
  },
  {
    icon: 'sparkles',
    keywords: [
      'popcorn', 'movie', 'movies', 'cinema', 'film', 'ticket', 'tickets', 'music', 'party', 'game',
      'games', 'gamepad', 'gaming', 'controller', 'joystick', 'toy', 'toys', 'sport', 'sports',
      'ball', 'entertainment', 'fun', 'hobby', 'hobbies', 'star', 'stars', 'magic', 'confetti',
      'celebration', 'holiday', 'vacation', 'art', 'paint', 'guitar', 'theater', 'theatre',
      'concert',
    ],
  },
];

/** `clock.png` -> `['clock']`, `atm-machine(2).png` -> `['atm', 'machine']`. */
function iconTokens(iconName: string): string[] {
  const lastSegment = iconName.split('/').pop() ?? iconName;
  const stripped = lastSegment
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, '')
    .replace(/\s*\(\d+\)\s*$/, '');
  return stripped.split(/[^a-z]+/).filter(Boolean);
}

/**
 * Maps a Cashew `icon_name` to the closest icon Qashy can render. Unknown names fall back to a
 * neutral icon for the category's kind rather than guessing.
 */
export function mapCashewCategoryIcon(iconName: string | null, kind: CategoryKind): string {
  const fallback = kind === 'income' ? 'plus.circle' : 'sparkles';
  if (!iconName) return fallback;
  const tokens = iconTokens(iconName);
  if (tokens.length === 0) return fallback;
  for (const rule of RULES) {
    if (tokens.some((token) => rule.keywords.includes(token))) return rule.icon;
  }
  return fallback;
}
