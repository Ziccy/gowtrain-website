export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center">
      <h1 className="text-6xl font-bold text-lime-400">
        GOWTRAIN
      </h1>

      <p className="mt-6 text-xl">
        Vind de trainer die bij jou past.
      </p>

      <button className="mt-8 bg-lime-400 text-black px-6 py-3 rounded-lg font-semibold">
        Start Nu
      </button>
    </main>
  );
}