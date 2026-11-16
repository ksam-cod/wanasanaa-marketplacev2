import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../server/db.js';

export const DEMO_PASSWORD = 'Wanasanaa2026!';

const studios = [
  {
    email: 'elena@wanasanaa.test',
    name: 'Elena Vane',
    studio: 'Elena Vane Atelier',
    location: 'Florence',
    discipline: 'Sculptural silver',
    bio: 'Hand-raised silver forms with a satin brush finish, made at a bench in Oltrarno.',
    works: [
      {
        title: 'Fluidic Horizon Cuff',
        category: 'Handcrafted Jewelry',
        medium: 'Hand-forged sterling silver ribbon',
        metal: '925 Silver',
        gemstone: null,
        dimensions: '58mm inner diameter',
        price: 48000,
        stock: 1,
        oneOfAKind: true,
        image:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuBqL63vLwIOw9y0duJvE4KdRUz0B248VxKKrkI1jyPwyC-fsMJb0mh7JjKDPTvZ8U45pVElHXoD8XVTBdtFRZEGqf27OenA18KleKa5kpyYb95pzR9ag4neH19vE0Yon_UKCApdFqIXCT25zbymA9CHhZgKX-u7dgRz8Z6QPdwd3v615owV753W2wcwpTzCMpSd6mE6wCW8bTIKdfJVbMIrzIP1CNQDHVuRoWNM_Pk',
        description:
          'A single sheet of sterling silver raised into an undulating wave cuff, finished with a soft satin brush so the highlights shift as it moves.',
      },
    ],
  },
  {
    email: 'kian@wanasanaa.test',
    name: 'Kian Sola',
    studio: 'Kian Sola Studio',
    location: 'Reykjavik',
    discipline: 'Raw crystal settings',
    bio: 'Oxidised silver cages built around unpolished Icelandic and Brazilian crystals.',
    works: [
      {
        title: 'Talismanic Drop Necklace',
        category: 'Handcrafted Jewelry',
        medium: 'Oxidised silver, hand-cut phantom quartz',
        metal: '925 Silver',
        gemstone: 'Ethiopian Opal',
        dimensions: 'Pendant 34mm, chain 55cm',
        price: 62000,
        stock: 1,
        oneOfAKind: true,
        image:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuAdZmPct5NsJM35IntDNqPiuzZqmE3SNhc8g1PeAyIXr6WZeu-IbV_i-aRJfSlfMILUlUpdhUdrsrpJX70CZN1QK6xkKl_uAsk4j4RzCRk2XCdMpkI6hZ7o0p_WT0or7k-kY3mH2fD0eSbUoHzCoCTZXipwLFBvbfMMMR5oBJTCJl3ZFgJf69QeP1YJmUgLSado_G0hDNPo7BV74SRkb3JZ2yI_Bqk9Lk1AuXuavoM',
        description:
          'A sharp phantom crystal of cyan quartz held in dark oxidised claws, hung from a hand-linked chain.',
      },
    ],
  },
  {
    email: 'haku@wanasanaa.test',
    name: 'Haku Mori',
    studio: 'Haku Atelier',
    location: 'Kyoto',
    discipline: 'Kintsugi ceramics',
    bio: 'Porcelain fragments from the kiln re-set in gold lacquer, a study of repair.',
    works: [
      {
        title: 'Kintsugi Ceramic Ring',
        category: 'Ceramic & Pottery',
        medium: 'Celadon porcelain, 24k gold lacquer',
        metal: '18k Recycled Gold',
        gemstone: null,
        dimensions: 'US 7, 12mm band',
        price: 41000,
        stock: 2,
        oneOfAKind: false,
        image:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuBMYR3UygKjGdBr4RD_-IU59vDE2iQYc4oiQGnnZlgmxni7MPcl9YvFgY__nNNBycZryvRVQnOU9OJ0LvFWdHfFernywctbeD6V0PIzhKextJBz0TKFdaBH4wZW14XEBf1Ldytv2NsyUeHzQ8uCnA2V-aVe1E_-fJfM2W7hsNEkChIZ5AYBkiWuwrOWkVdl5fwTPvcWHVJ0mwGzfMrgsGoeAm-jwpjFCc4afxTRvRE',
        description:
          'An antique celadon shard fused with a seam of pure gold lacquer and set into a polished band. Each ring keeps the fault line of its original vessel.',
      },
    ],
  },
  {
    email: 'bauhaus@wanasanaa.test',
    name: 'Ines Reinhardt',
    studio: 'Bauhaus Métaux',
    location: 'Berlin',
    discipline: 'Architectural jewellery',
    bio: 'Platinum and titanium structures reduced to their load-bearing lines.',
    works: [
      {
        title: 'Architectural Bar Earrings',
        category: 'Architectural Sculptures',
        medium: '950 platinum, channel-set aquamarine',
        metal: 'Platinum',
        gemstone: 'Raw Tourmaline',
        dimensions: '42mm drop',
        price: 94000,
        stock: 2,
        oneOfAKind: false,
        image:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuD2pzMTrN3LXlcJ3lKWfqGJpJ4ieNDf53wBYI_yCq_JNFTV9g5iUEnncFoyyKz3SoUlAQB5fmRqHtFVGr0tdoC-ntY5ekijkEilAxM2TJpqfimDQliVrDg7IkGqsZLwHJRj6xAd4R6NBcI7yIFHEJ6U_lZeByWlDhNWEuuaHPYVGvXGiZu3Uwm8cV00-AWQ4QFolb-G_aIarQXCRjmtl4IFqL-7fTs02wyvF21ujcU',
        description:
          'A pair of platinum bars holding vertical baguette aquamarines, weighted to hang straight.',
      },
    ],
  },
  {
    email: 'marais@wanasanaa.test',
    name: 'Thandi Marais',
    studio: 'Marais & Thorne',
    location: 'Cape Town',
    discipline: 'Brutalist settings',
    bio: 'Untamed crystals caged in anodised titanium, assembled by hand in Woodstock.',
    works: [
      {
        title: 'Raw Tourmaline Brooch',
        category: 'Wearable Haute Crafts',
        medium: 'Anodised titanium, raw bi-colour tourmaline',
        metal: 'Titanium',
        gemstone: 'Raw Tourmaline',
        dimensions: '76mm × 28mm',
        price: 118000,
        stock: 1,
        oneOfAKind: true,
        image:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuD8xQOXNoZi3PZ8wv-DuO5Nmj0Y7g3L2rl4e55DxwB6vnIdCNy6E9Fk50sIMPawVwULFyKrV0z4kUd9LqQuOlAFMI7TrpA0rTOQJaTCXYxZWRn-5c2zJgZAxBeRojPzxwm7RjLMKIqqn4u866uwxvedhpsQfQmEleC1bXrqFwiS5LaMJjoVm2xqgK-76qtpjzaI36ehjH4ylnpHkiEYUDUK_6OsciFBE77YiWwfyKY',
        description:
          'A raw tourmaline rod shifting from neon cyan to smoky teal, held in a wireframe titanium cage.',
      },
    ],
  },
  {
    email: 'ousmane@wanasanaa.test',
    name: 'Ousmane Cissé',
    studio: 'Atelier Cissé',
    location: 'Dakar',
    discipline: 'Hand-forged chain',
    bio: 'Every link soldered and hammered at the bench, no castings.',
    works: [
      {
        title: 'Nomadic Link Bracelet',
        category: 'Handcrafted Jewelry',
        medium: 'Hand-soldered organic silver links',
        metal: '925 Silver',
        gemstone: null,
        dimensions: '20cm, 14mm links',
        price: 57000,
        stock: 2,
        oneOfAKind: false,
        image:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuCzoC2UzKUeDHv_FIs-dz7K6uQ-0asfCPqogrFTPv5yvOfVCwdeqwb5MlSPWiiFeNFIY1gAsVGjOqMDRN2gu-Hxm0DVlyNCZwGXsYLLWXwZr98JmlcGveYLkcmAjLovQAVKm6Rg0khV92GIk_DRs_IynKEvdhL2ENhKOnULRGmCP-elQ2x0L4MED-yeC8FNhbOjQhMryuiqWIWIDL2niXZd6odpA2ye9-Gk8UpnPvE',
        description:
          'Heavy silver links with visible hammer marks, each one closed with a hand-fed solder seam.',
      },
    ],
  },
  {
    email: 'aurelia@wanasanaa.test',
    name: 'Aurelia Cruz',
    studio: 'Aurelia Cruz Studio',
    location: 'Santa Fe',
    discipline: 'Turquoise and gold',
    bio: 'Desert stones set in recycled gold, engraved by hand.',
    works: [
      {
        title: 'Solar Flare Signet Ring',
        category: 'Handcrafted Jewelry',
        medium: 'Engraved 14k gold, turquoise cabochon',
        metal: '18k Recycled Gold',
        gemstone: 'Ethiopian Opal',
        dimensions: 'US 8, 16mm face',
        price: 112000,
        stock: 1,
        oneOfAKind: true,
        image:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuAcJYQxetiPc1TSX6y_-XApd5okOFidYylxK8HLpmiSF6r6lBBHCjKelEF5joY660AspoD57RWp2gZpVKGjXrkx3IgXbR4aDBvACP1pjRyWjRGColG0jmH7BoUG7wbPMEjymgi8rxhWTlwF34SgNA2mbwcgmokxrwtuF9Xb7tPm_C9Wqyc46Y763XS_DvkuPbsCbnmMEBh-vujEiF0WIt-0W0E_7lv4WJhM6PffNRU',
        description:
          'A signet carved with sunburst rays around a Sleeping Beauty turquoise cabochon with black web matrix.',
      },
    ],
  },
  {
    email: 'linnea@wanasanaa.test',
    name: 'Linnea Berg',
    studio: 'Linnea Berg Atelier',
    location: 'Stockholm',
    discipline: 'Pearl kinetics',
    bio: 'Baroque pearls suspended on memory wire so the piece moves with the wearer.',
    works: [
      {
        title: 'Lunar Pearl Kinetic Choker',
        category: 'Handcrafted Jewelry',
        medium: 'Baroque South Sea pearl, platinum memory cable',
        metal: 'Platinum',
        gemstone: null,
        dimensions: '38cm cable',
        price: 84000,
        stock: 1,
        oneOfAKind: true,
        image:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuB-d1mIrTFUUz3QnJ5OPfiKQqYkSJWu_XV-Xy7QmSC5qHnfB3z1_doJdYl1bunCFt9j5k7bBHP1Xm-A81n-65gY-U2MCwpOGwe-22_lIMApzkxfY8akxgyibmA8G_PJgtM4uFgd6KTX6vfaKG_VVA3VL_eCzBlASTX1f745QhJdqcnfeH9Bu-_urVnpfJ4jvVyOTjHbTuR3D5DbsNzvuNXCS5I0mw-nzTXbltYt-C0',
        description:
          'A freeform baroque pearl threaded onto a flexible platinum cable that holds its curve around the neck.',
      },
    ],
  },
  {
    email: 'mael@wanasanaa.test',
    name: 'Mael Nyx',
    studio: 'Mael Nyx Atelier',
    location: 'Zurich & Nairobi',
    discipline: 'Haute joaillerie',
    bio: 'Fairmined gold and exceptional stones, cut and set between Zurich and Nairobi.',
    works: [
      {
        title: 'The Cyan Aurora Solstice Ring',
        category: 'Handcrafted Jewelry',
        medium: '18k Fairmined white gold, Paraíba tourmaline, pavé diamonds',
        metal: '18k Recycled Gold',
        gemstone: 'Paraíba & Cyan',
        dimensions: 'US 6.5, 2.84ct centre stone',
        price: 448500,
        stock: 1,
        oneOfAKind: true,
        featured: true,
        image:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuDj9FK98BciiUC85SQ1fRxvqjucOD-BbTc1HCLoDHmFqx4R4zx1mbdzVzNKmr-_3kFUW8vqtoUGfJBIWh2frCwmUZy0amftb940NOEdI1dsR4ZoIAx5NlZ-mZI_22BTacUG3PQ62sPzhpax-FU0GAO3wZE0l8WS752icnRzokIrpucPbysbcJa_GJvSWz-23Bmh9NAYwUMPieCljwnzxVRbQLg0xS5UTeN-UiBNkdc',
        description:
          'Carved from a single wax monolith and cast in conflict-free gold. The Paraíba tourmaline carries an electric cyan saturation, cradled by hand-set micro-brilliant diamonds.',
      },
    ],
  },
];

const collectors = [
  { email: 'collector@wanasanaa.test', name: 'Achieng Odhiambo', phone: '254712345678' },
  { email: 'njeri@wanasanaa.test', name: 'Njeri Kamau', phone: '254798765432' },
];

export async function seedDatabase() {
  const existing = await query('SELECT COUNT(*)::int AS count FROM users');
  if (existing.rows[0].count > 0) {
    return { seeded: false };
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const artworkIds = new Map();

  await withTransaction(async (client) => {
    for (const studio of studios) {
      const { rows: userRows } = await client.query(
        `INSERT INTO users (name, email, password_hash, role, phone)
         VALUES ($1, $2, $3, 'artist', NULL) RETURNING id`,
        [studio.name, studio.email, passwordHash],
      );
      const { rows: artistRows } = await client.query(
        `INSERT INTO artists (user_id, studio_name, location, bio, discipline, verified, commission_rate)
         VALUES ($1, $2, $3, $4, $5, true, 0.12) RETURNING id`,
        [userRows[0].id, studio.studio, studio.location, studio.bio, studio.discipline],
      );

      for (const work of studio.works) {
        const { rows } = await client.query(
          `INSERT INTO artworks
             (artist_id, title, description, medium, category, metal, gemstone, dimensions,
              price_kes, stock, one_of_a_kind, image_url, status, is_featured)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'published', $13)
           RETURNING id`,
          [
            artistRows[0].id,
            work.title,
            work.description,
            work.medium,
            work.category,
            work.metal,
            work.gemstone,
            work.dimensions,
            work.price,
            work.stock,
            work.oneOfAKind,
            work.image,
            Boolean(work.featured),
          ],
        );
        artworkIds.set(work.title, { id: rows[0].id, artistId: artistRows[0].id, price: work.price });
      }
    }

    const buyerIds = [];
    for (const collector of collectors) {
      const { rows } = await client.query(
        `INSERT INTO users (name, email, password_hash, role, phone)
         VALUES ($1, $2, $3, 'collector', $4) RETURNING id`,
        [collector.name, collector.email, passwordHash, collector.phone],
      );
      buyerIds.push(rows[0].id);
    }

    const seedOrder = async ({ buyerId, relativeDays, number, items, reviews }) => {
      let subtotal = 0;
      for (const item of items) subtotal += artworkIds.get(item.title).price * item.quantity;

      const { rows: orderRows } = await client.query(
        `INSERT INTO orders
           (order_number, buyer_id, status, subtotal_kes, shipping_kes, total_kes,
            shipping_name, shipping_phone, shipping_address, shipping_city, paid_at, created_at)
         VALUES ($1, $2, 'paid', $3, 0, $3, $4, $5, $6, $7, now() - ($8 || ' days')::interval, now() - ($8 || ' days')::interval)
         RETURNING id`,
        [
          number,
          buyerId,
          subtotal,
          buyerId === buyerIds[0] ? 'Achieng Odhiambo' : 'Njeri Kamau',
          buyerId === buyerIds[0] ? '254712345678' : '254798765432',
          'Kileleshwa Lane 12',
          'Nairobi',
          String(relativeDays),
        ],
      );
      const orderId = orderRows[0].id;

      await client.query(
        `INSERT INTO payments (order_id, phone, amount_kes, status, simulated, checkout_request_id,
                               mpesa_receipt, result_code, result_desc, completed_at, created_at)
         VALUES ($1, $2, $3, 'succeeded', true, $4, $5, 0, 'Seed payment', now() - ($6 || ' days')::interval, now() - ($6 || ' days')::interval)`,
        [
          orderId,
          buyerId === buyerIds[0] ? '254712345678' : '254798765432',
          subtotal,
          `ws_CO_SIM_${number}`,
          `SIM${number.replace(/\W/g, '')}`,
          String(relativeDays),
        ],
      );

      for (const item of items) {
        const artwork = artworkIds.get(item.title);
        const { rows: itemRows } = await client.query(
          `INSERT INTO order_items
             (order_id, artwork_id, artist_id, title, quantity, unit_price_kes, line_total_kes, commission_rate,
              created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 0.12, now() - ($8 || ' days')::interval)
           RETURNING id`,
          [
            orderId,
            artwork.id,
            artwork.artistId,
            item.title,
            item.quantity,
            artwork.price,
            artwork.price * item.quantity,
            String(relativeDays),
          ],
        );
        await client.query('UPDATE artworks SET stock = stock - $2 WHERE id = $1', [
          artwork.id,
          item.quantity,
        ]);
        await client.query(
          `INSERT INTO earnings
             (order_item_id, order_id, artwork_id, artist_id, gross_kes, platform_fee_kes, net_kes, created_at)
           VALUES ($1, $2, $3, $4, $5::int, ROUND($5::int * 0.12)::int,
                   $5::int - ROUND($5::int * 0.12)::int,
                   now() - ($6 || ' days')::interval)`,
          [
            itemRows[0].id,
            orderId,
            artwork.id,
            artwork.artistId,
            artwork.price * item.quantity,
            String(relativeDays),
          ],
        );
      }

      for (const review of reviews) {
        const artwork = artworkIds.get(review.artworkTitle);
        await client.query(
          `INSERT INTO reviews (artwork_id, buyer_id, order_id, rating, title, body, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, now() - ($7 || ' days')::interval)`,
          [
            artwork.id,
            buyerId,
            orderId,
            review.rating,
            review.title,
            review.body,
            String(Math.max(0, relativeDays - 2)),
          ],
        );
      }
    };

    await seedOrder({
      buyerId: buyerIds[0],
      relativeDays: 24,
      number: 'WS-SEED-1001',
      items: [
        { title: 'Kintsugi Ceramic Ring', quantity: 1 },
        { title: 'Fluidic Horizon Cuff', quantity: 1 },
      ],
      reviews: [
        {
          artworkTitle: 'Kintsugi Ceramic Ring',
          title: 'The seam is the point',
          rating: 5,
          body: 'The gold seam catches the light exactly as it did in the studio photos. Packaging was a proper wooden case and the provenance card is signed.',
        },
        {
          artworkTitle: 'Fluidic Horizon Cuff',
          title: 'Wears like water',
          rating: 5,
          body: 'I have worn this cuff every day for three weeks. The satin finish has softened beautifully and it never catches on knitwear.',
        },
      ],
    });

    await seedOrder({
      buyerId: buyerIds[1],
      relativeDays: 9,
      number: 'WS-SEED-1002',
      items: [{ title: 'Nomadic Link Bracelet', quantity: 1 }],
      reviews: [
        {
          artworkTitle: 'Nomadic Link Bracelet',
          title: 'Heavy in the best way',
          rating: 4,
          body: 'The hammer marks are gorgeous and the clasp is very secure. Took a day longer than promised to ship but the studio kept me updated.',
        },
      ],
    });

    const inquiries = [
      {
        title: 'The Cyan Aurora Solstice Ring',
        buyerIndex: 0,
        name: 'Achieng Odhiambo',
        email: 'collector@wanasanaa.test',
        phone: '254712345678',
        daysAgo: 2,
      },
      {
        title: 'Raw Tourmaline Brooch',
        buyerIndex: 1,
        name: 'Njeri Kamau',
        email: 'njeri@wanasanaa.test',
        phone: '254798765432',
        daysAgo: 3,
      },
    ];

    for (const inquiry of inquiries) {
      const artwork = artworkIds.get(inquiry.title);
      await client.query(
        `INSERT INTO inquiries
           (artwork_id, artist_id, user_id, name, email, phone, subject, message, budget_kes, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', now() - ($10 || ' days')::interval)`,
        [
          artwork.id,
          artwork.artistId,
          buyerIds[inquiry.buyerIndex],
          inquiry.name,
          inquiry.email,
          inquiry.phone,
          `Commission inquiry — ${inquiry.title}`,
          'Could this be resized, and would you consider a variant with a darker stone? I would like to discuss a bespoke commission.',
          600000,
          String(inquiry.daysAgo),
        ],
      );
    }
  });

  return { seeded: true };
}
