// import { Inter } from "next/font/google";
import NavBar from "@/components/NavBar";
import Hero from "@/components/HeroSection";
import Footer from "@/components/Footer";
import Stats from "@/components/Stats";

export default function Home() {
  return (
    <>
      <Hero />
      <Stats />
      <Footer />
    </>
  );
}
