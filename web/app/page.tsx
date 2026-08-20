import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getLocation, getMenu, type Product } from "@/lib/supabase";

const WHATSAPP_URL =
  "https://wa.me/584120839311?text=%C2%A1Hola%20Casa%20Lucenzo!%20%F0%9F%91%8B%20Quiero%20hacer%20un%20pedido.";

function formatPrice(price: number) {
  return new Intl.NumberFormat("es-VE", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(price);
}

function groupByCategory(products: Product[]) {
  const groups = new Map<string, Product[]>();
  for (const product of products) {
    const key = product.category ?? "otros";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(product);
  }
  return groups;
}

export default async function Home() {
  const location = await getLocation("casa-luccenzo");
  const products = location ? await getMenu(location.id) : [];
  const inStock = products.filter((p) => p.stock > 0);
  const menuByCategory = groupByCategory(inStock);

  return (
    <>
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <span className="font-mono text-sm font-semibold tracking-tight">
            Casa Lucenzo
          </span>
          <Button asChild size="sm">
            <a href="#menu">Ver menú</a>
          </Button>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        {/* Hero */}
        <section className="flex flex-col items-center gap-6 px-6 pt-16 pb-20 text-center">
          <Image
            src="/logo.png"
            alt="Escudo de Casa Lucenzo"
            width={112}
            height={112}
            className="rounded-full shadow-md"
            priority
          />
          <p className="font-mono text-xs uppercase tracking-widest text-accent-text">
            Desayunos &amp; Pastelería Familiar · Venezuela
          </p>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            80 años de historia y tradición
          </h1>
          <p className="max-w-prose text-lg text-muted-foreground">
            El mismo sabor de siempre, hecho a mano, todos los días. Pastelitos
            y dulces que acompañan a varias generaciones de familias.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Button asChild size="lg">
              <a href="#menu">Ver el menú</a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
                Pedir por WhatsApp
              </a>
            </Button>
          </div>
        </section>

        {/* Historia */}
        <section className="border-t bg-secondary/40">
          <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-16">
            <p className="font-mono text-xs uppercase tracking-widest text-accent-text">
              Nuestra historia
            </p>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Una receta que pasa de generación en generación
            </h2>
            <p className="max-w-prose text-muted-foreground">
              Casa Lucenzo nació como un pequeño negocio familiar y hoy sigue
              siendo eso: una casa que amasa, hornea, fríe y sirve todos los
              días con la misma receta de siempre.
            </p>
          </div>
        </section>

        {/* Menú */}
        <section id="menu" className="border-t">
          <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
            <div className="flex flex-col gap-2">
              <p className="font-mono text-xs uppercase tracking-widest text-accent-text">
                Lo que horneamos hoy
              </p>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                De la vitrina a tu mesa
              </h2>
              <p className="max-w-prose text-muted-foreground">
                Todo se hace fresco en el día — el sabor de la casa, sin
                atajos.
              </p>
            </div>

            {menuByCategory.size === 0 && (
              <p className="text-muted-foreground">
                No hay productos disponibles en este momento. Volvé a intentar
                más tarde.
              </p>
            )}

            <div className="flex flex-col gap-8">
              {[...menuByCategory.entries()].map(([category, items]) => (
                <div key={category} className="flex flex-col gap-3">
                  <h3 className="font-mono text-xs uppercase tracking-widest text-accent-text">
                    {category}
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {items.map((product) => (
                      <Card key={product.id}>
                        <CardContent className="flex items-baseline justify-between gap-4">
                          <span className="font-medium">{product.name}</span>
                          <span className="font-mono text-sm text-muted-foreground tabular-nums">
                            {formatPrice(product.price)}
                          </span>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Encuéntranos */}
        <section className="border-t bg-secondary/40">
          <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-16">
            <p className="font-mono text-xs uppercase tracking-widest text-accent-text">
              Encuéntranos
            </p>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Síguenos en nuestras redes
            </h2>
            <p className="max-w-prose text-muted-foreground">
              O escribinos directo por WhatsApp si preferís coordinar el
              pedido por chat.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button asChild variant="outline">
                <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
                  WhatsApp
                </a>
              </Button>
              <Button asChild variant="outline">
                <a
                  href="https://www.instagram.com/casalucenzo"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Instagram
                </a>
              </Button>
              <Button asChild variant="outline">
                <a
                  href="https://www.facebook.com/profile.php?id=61593235718793"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Facebook
                </a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t px-6 py-8">
        <div className="mx-auto max-w-3xl text-sm text-muted-foreground">
          Casa Lucenzo · Abierto todos los días, 6:00 a.m. – 2:00 p.m. ·
          Dirección próximamente.
        </div>
      </footer>
    </>
  );
}
