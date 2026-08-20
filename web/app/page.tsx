import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getLocation, getMenu, type Product } from "@/lib/supabase";

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
            Casa Luccenzo
          </span>
          <Button asChild size="sm">
            <a href="#menu">Ver menú</a>
          </Button>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-1 flex-col gap-16 px-6 py-16">
        <section className="flex flex-col gap-4">
          <p className="font-mono text-xs uppercase tracking-widest text-accent-text">
            {location?.name ?? "Casa Luccenzo"}
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Pastelitos recién hechos, todos los días.
          </h1>
          <p className="max-w-prose text-muted-foreground">
            Este es el nuevo sitio público de Casa Luccenzo — el menú de
            abajo se lee en vivo de la misma base de datos que usa el sistema
            de caja, así que siempre muestra lo que hay disponible hoy.
          </p>
        </section>

        <section id="menu" className="flex flex-col gap-8">
          <h2 className="text-2xl font-semibold tracking-tight">Menú</h2>

          {menuByCategory.size === 0 && (
            <p className="text-muted-foreground">
              No hay productos disponibles en este momento. Volvé a intentar
              más tarde.
            </p>
          )}

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
        </section>
      </main>

      <footer className="border-t px-6 py-8">
        <div className="mx-auto max-w-3xl text-sm text-muted-foreground">
          {/* TODO: reemplazar con datos reales (WhatsApp, dirección, horario) antes de publicar */}
          Casa Luccenzo · Contacto y horario próximamente.
        </div>
      </footer>
    </>
  );
}
