/**
 * TEST FIXTURES ONLY — fictional organisations, used to exercise the research code.
 * Never imported by application code.
 */
import type { SearchResult } from "@/lib/search/types";

const r = (url: string, title: string, snippet: string, score = 0.8, provider = "mock"): SearchResult => ({ url, title, snippet, score, provider });

/** One clear organisation: Asha Kiran Foundation (fictional), Hyderabad. */
export const CLEAR_RESULTS: SearchResult[] = [
  r("https://www.ashakiranfoundation.org/", "Asha Kiran Foundation | Education for every child in Hyderabad", "Asha Kiran Foundation runs after-school learning centres in Hyderabad, Telangana."),
  r("https://www.ashakiranfoundation.org/about?utm_source=x", "About us - Asha Kiran Foundation", "Founded to support children in Hyderabad slums with tutoring."),
  r("https://www.ashakiranfoundation.org/donate", "Donate - Asha Kiran Foundation", "Support our learning centres."),
  r("https://www.instagram.com/ashakiranfoundation/", "Asha Kiran Foundation (@ashakiranfoundation)", "Instagram profile"),
  r("https://www.guidestarindia.org/Summary.aspx?CCReg=1234", "Asha Kiran Foundation - GuideStar India", "Asha Kiran Foundation, Hyderabad, Telangana. Education."),
  r("https://www.thehindu.com/news/cities/Hyderabad/learning-centres/article1.ece", "Learning centres expand in city", "Asha Kiran Foundation opened two new centres."),
];

/** Two different NGOs sharing a name: Hope Foundation in Hyderabad vs Kolkata (fictional). */
export const AMBIGUOUS_RESULTS: SearchResult[] = [
  r("https://www.hopefoundation.org.in/", "Hope Foundation Hyderabad - Women's livelihood programmes", "Hope Foundation works with women in Hyderabad, Telangana on skills and livelihoods."),
  r("https://www.hopefoundation.org.in/programmes", "Programmes - Hope Foundation Hyderabad", "Skill training centres across Hyderabad."),
  r("https://hopefoundationkolkata.in/", "Hope Foundation | Child health in Kolkata", "Hope Foundation provides child health camps in Kolkata, West Bengal."),
  r("https://hopefoundationkolkata.in/about", "About - Hope Foundation Kolkata", "Our health camps reach slum communities in Kolkata."),
];

export const NOTHING_RELEVANT: SearchResult[] = [
  r("https://www.justdial.com/Hyderabad/Plumbers", "Plumbers in Hyderabad", "Best plumbers"),
  r("https://www.example-shop.com/", "Buy shoes online", "Shoes"),
];
