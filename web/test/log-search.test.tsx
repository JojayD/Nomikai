import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import LogPage from "@/app/log/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/header", () => ({ default: () => null }));

test.each(["Vodka", "Vodka Shot"])("prioritizes exact %s over brand and history matches", (name) => {
  const names = ["Absolut", "Ciroc", "Grey Goose", "Ketel One", "Smirnoff", "Tito's"]
    .flatMap((brand) => [`${brand} Vodka`, `${brand} Vodka Shot`]);
  const drinks = [...names, "Vodka", "Vodka Shot"].map((name, index) => ({
    id: index + 1, name, normalized_name: name.toLowerCase(), is_alcoholic: true,
  }));
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(["me"], { id: "owner" });
  client.setQueryData(["drinks"], drinks);
  // Repeated partial matches must not crowd out an exact catalog match either.
  client.setQueryData(["drink-history"], names.map((name, index) => ({
    drink_id: index + 1, custom_drink_name: null, normalized_drink_name: name.toLowerCase(),
  })));
  render(<QueryClientProvider client={client}><LogPage /></QueryClientProvider>);
  const input = screen.getByLabelText("What are you drinking?");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: `  ${name.toUpperCase()}  ` } });
  const match = screen.getByRole("button", { name });
  expect(screen.getAllByRole("button")[0]).toBe(match);
  expect(screen.queryByRole("button", { name: /as written/ })).toBeNull();
  fireEvent.click(match);
  expect(screen.getByRole("button", { name: "Change" })).toBeDefined();
  expect(screen.getByText(name)).toBeDefined();
});

test("steps forward and back without losing what was entered", () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(["me"], { id: "owner" });
  client.setQueryData(["drinks"], []);
  client.setQueryData(["night-outs"], []);
  render(<QueryClientProvider client={client}><LogPage /></QueryClientProvider>);
  const hidden = (label: RegExp) =>
    screen.getByLabelText(label).closest(".field")!.className.includes("max-lg:!hidden");

  expect(screen.getByRole("button", { name: "Back" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText(/2 \/ 4/)).toBeDefined();
  expect(hidden(/Where/)).toBe(false);
  expect(hidden(/Note/)).toBe(true);
  fireEvent.change(screen.getByLabelText(/Where/), { target: { value: "Some bar" } });

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Meh" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("button", { name: "Next" })).toHaveProperty("disabled", true);
  expect(hidden(/Note/)).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("button", { name: "Meh" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText<HTMLInputElement>(/Where/).value).toBe("Some bar");
});
