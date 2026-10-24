# Angular and .NET news sources

One list of the sites the gather reads, and the ones it doesn't, with the reason. The gather itself reads
[sources.md](../../sources.md); keep the two in step when you add or drop a site.

Every feed below was fetched on **2026-10-24**. "Last 30 days" counts that feed's posts from 2026-09-24 on.

**Rules for a site to be in the list**

- It has a working RSS/Atom feed (or a page the gather can read with CSS selectors).
- It posted in the last few months.
- Most of what it posts is news or technical writing developers act on: releases, breaking changes, new features,
  security, tooling, in-depth guides. Product marketing, career/HR posts and general tech news are out.
- It isn't a copy of another site in the list (reposts, aggregators, a second feed for the same release).

## Angular

| Site | Feed | Kind | Last 30 days | In sources.md |
| --- | --- | --- | ---: | --- |
| [Angular Blog](https://blog.angular.dev) | `https://blog.angular.dev/feed` | Official blog | 4 | yes |
| [Angular releases](https://github.com/angular/angular/releases) | `https://github.com/angular/angular/releases.atom` | Official releases | 10+ | yes |
| [Angular CLI releases](https://github.com/angular/angular-cli/releases) | `https://github.com/angular/angular-cli/releases.atom` | Official releases | 10+ | yes |
| [Angular components releases](https://github.com/angular/components/releases) (Material, CDK) | `https://github.com/angular/components/releases.atom` | Official releases | 8 | yes |
| [NgRx releases](https://github.com/ngrx/platform/releases) | `https://github.com/ngrx/platform/releases.atom` | Ecosystem releases | 0 (last: Sep 10) | yes |
| [Ninja Squad](https://blog.ninja-squad.com) | `https://blog.ninja-squad.com/atom.xml` | "What's new in Angular x.y" for every release | 0 (last: Sep 23) | yes |
| [Angular Architects](https://www.angulararchitects.io/en/blog/) (Manfred Steyer) | `https://www.angulararchitects.io/en/feed/` | Release write-ups, architecture | 1 | yes |
| [Angular Space](https://www.angularspace.com) | `https://www.angularspace.com/rss/` | Community articles | 2 | yes |
| [Angular University](https://blog.angular-university.io) | `https://blog.angular-university.io/rss/` | In-depth guides | 1 | yes |
| [Angular Training Blog](https://blog.angulartraining.com) (Alain Chautard) | `https://blog.angulartraining.com/feed` | Tips on new features | 1 | yes |
| [Angular Addicts](https://www.angularaddicts.com) | `https://www.angularaddicts.com/feed` | Monthly newsletter | 1 | yes |
| [Angular in Depth](https://angularindepth.com) | `https://angularindepth.com/feed.xml` | Hub: weekly Ng-News plus reposts | 17 | listed, off |

Angular in Depth carries **Ng-News**, a good weekly news roundup, but it also reposts the Angular Blog and
Angular.love's recruitment/HR posts. It's in sources.md switched off; turn it on in Admin → Sources if you want Ng-News.

## .NET

| Site | Feed | Kind | Last 30 days | In sources.md |
| --- | --- | --- | ---: | --- |
| [.NET Blog](https://devblogs.microsoft.com/dotnet) | `https://devblogs.microsoft.com/dotnet/feed/` | Official blog (C#, ASP.NET Core, EF Core, MAUI, NuGet) | 10 | yes |
| [.NET releases](https://github.com/dotnet/core/releases) | `https://github.com/dotnet/core/releases.atom` | Official release notes (every .NET release and preview) | 4 | yes |
| [Aspire releases](https://github.com/dotnet/aspire/releases) | `https://github.com/dotnet/aspire/releases.atom` | Official releases | 5 | yes |
| [.NET MAUI releases](https://github.com/dotnet/maui/releases) | `https://github.com/dotnet/maui/releases.atom` | Official releases (mobile/desktop) | 2 | listed, off |
| [Visual Studio Blog](https://devblogs.microsoft.com/visualstudio) | `https://devblogs.microsoft.com/visualstudio/feed/` | Official IDE news | 7 | yes |
| [JetBrains .NET Blog](https://blog.jetbrains.com/dotnet) | `https://blog.jetbrains.com/dotnet/feed/` | Rider/ReSharper releases, .NET tooling | 4 | yes |
| [InfoQ .NET](https://www.infoq.com/dotnet) | `https://feed.infoq.com/dotnet/` | News site | 2 | yes |
| [Visual Studio Magazine](https://visualstudiomagazine.com) | `https://visualstudiomagazine.com/rss-feeds/news.aspx` | News site (.NET, Blazor, VS, GitHub) | 34 | yes |
| [Andrew Lock – .NET Escapades](https://andrewlock.net) | `https://andrewlock.net/rss.xml` | In-depth ASP.NET Core / .NET | 2 | yes |
| [Milan Jovanović](https://www.milanjovanovic.tech) | `https://www.milanjovanovic.tech/rss/feed.xml` | .NET architecture, weekly | 5 | yes |
| [Rick Strahl's Web Log](https://weblog.west-wind.com) | `https://feeds.feedburner.com/rickstrahl` | ASP.NET Core, web tooling | 1 | yes |
| [Damien Bowden](https://damienbod.com) | `https://damienbod.com/feed/` | ASP.NET Core security, OAuth/OIDC | 1 | yes |
| [elmah.io blog](https://blog.elmah.io) | `https://blog.elmah.io/rss/` | .NET 10/11 features, web APIs | 3 | yes |
| [C# Digest](https://csharpdigest.net) | `https://csharpdigest.net/newsletters.rss` | Weekly newsletter | 4 | yes |

`.NET releases` replaces the runtime, ASP.NET Core, EF Core and SDK release feeds: all four publish the same
`.NET 10.0.13`-style release, so each release showed up four times.

## Both

| Site | Feed | Kind | Last 30 days | In sources.md |
| --- | --- | --- | ---: | --- |
| [TypeScript Blog](https://devblogs.microsoft.com/typescript) | `https://devblogs.microsoft.com/typescript/feed/` | Official TypeScript releases | 1 | yes |

## Not used, and why

**Duplicates**

- Angular Blog was listed twice (Official, and Notable Blogs "inc. Angular Weekly"); Kendo UI Blog is the Telerik blog.
- .NET runtime, ASP.NET Core, EF Core and SDK release feeds — the same releases as `.NET releases`.
- Microsoft DevBlogs (all teams), NuGet Blog — the .NET-relevant posts are already in the .NET and Visual Studio blogs.
- TypeScript GitHub releases — the same releases as the TypeScript Blog.
- .NET Ramblings, Morning Dew (Alvin Ashcraft), The Morning Brew, daily.dev — aggregators of links from the sites above
  (.NET Ramblings: 260 posts a month, many not in English). The Morning Brew's feed stopped in Aug 2024.
- Angular in Depth — reposts (see above).

**Not news sources** (no feed of news, or Q&A/chat)

- angular.dev, learn.microsoft.com/dotnet — documentation.
- Stack Overflow tags, Reddit (r/angular, r/Angular2, r/dotnet, r/csharp), Angular Discord, .NET Discord,
  .NET Foundation Slack, ASP.NET Forums, Microsoft Q&A, Hashnode tags — questions and discussion.
- X/Twitter, Bluesky, LinkedIn groups — social posts; the same news reaches the blogs above.
- Angular and .NET YouTube channels, .NET Rocks!, Hanselminutes — video and audio.
- GitHub repositories themselves — their release feeds are used instead.

**Inactive**

- Angular Weekly (Substack) — last issue May 2023. Angular Digest — last issue Feb 2026.
- Code Maze — feed's newest post is Feb 2025. Offering Solutions (Fabian Gosebrink) — Jan 2026.
- Steve Gordon — Feb 2026. Jimmy Bogard — Jul 2026. Ardalis — Aug 2026.
- ASP.NET Blog — moved into the .NET Blog in 2023. .NET Foundation Show, The DevLife — ended.
- ng-newsletter — archived. Weekly Angular (weeklyangular.com) — domain no longer resolves.

**Mostly off-topic or marketing**

- Syncfusion and Telerik blogs — product promotion and general topics (React, graph databases).
- C# Corner — high volume, mostly unrelated (cars, business checklists).
- DEV `#angular` / `#dotnet` — anyone can post; quality and topic vary.
- Angular.love — mixes Angular posts with recruitment/HR articles.
- Scott Hanselman's blog — recent posts are about home networking. Dev Leader — mostly management advice.
- Rainer Hahnekamp on DEV — now posts AI news (his Angular news is Ng-News on Angular in Depth).
- Azure Blog, Morning Brew (morningbrew.com), JavaScript Weekly and similar — broad, little Angular/.NET news.

**No working feed** (checked 2026-10-24)

- Netanel Basal, This Dot, Ultimate Courses, PrimeNG blog, Angular Experts, Thinktecture, Meziantou, Khalid Abuhakmeh,
  DotNetKicks, .NET Foundation, DotNetWeekly, Awesome .NET (LibHunt), The .NET Weekly (email only).
