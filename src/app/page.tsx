import type { Metadata } from "next";
import { QUIZ_CATALOG, type PublicQuizCard } from "@/core/quiz";
import { HomeFrontPage } from "@/components/home/home-front-page";

/**
 * The catalog stays on the server: the loader functions cannot cross the RSC
 * boundary, and keeping the registry out of the client keeps the homepage
 * bundle light. The homepage receives the sixteen entries as plain cards.
 */
const cards: PublicQuizCard[] = QUIZ_CATALOG.map((entry) => {
  const { load, ...card } = entry;
  void load;
  return card;
});

export const metadata: Metadata = {
  title: { absolute: "认识你自己 | Know Yourself" },
  description: "有点迷茫，或者就是无聊的时候来做个测评；做完测评，可以看看大家发的帖子，也可以自己发帖，跟社区里的人互动。 A quiz site for when you feel a bit lost or just bored — take an assessment, then read what others post or share your own.",
};

export default function HomePage() {
  return <HomeFrontPage cards={cards} />;
}
