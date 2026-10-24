# News sources

The gather reads every **enabled** source below. Edit this file or use **Admin → Sources**, which saves its changes
to this file.

- One table row per source. `##` headings group sources into sections.
- **Feed**: an RSS/Atom link, or a web page link when **Selectors** is filled in.
- **Tags**: comma separated; used when the AI can't tag a story.
- **Enabled**: `yes` or `no`.
- **Selectors** (only for sites without a feed): `item=…; title=…; link=…; date=…; summary=…`.
  Add `@attr` to read an attribute, e.g. `link=a@href`.

Why each site is here (and which were left out) is in [docs/resources/news-sources.md](docs/resources/news-sources.md).

## Angular

| Name | Feed | Website | Tags | Enabled | Selectors |
| --- | --- | --- | --- | --- | --- |
| Angular Blog | https://blog.angular.dev/feed | https://blog.angular.dev | angular | yes |  |
| Angular releases | https://github.com/angular/angular/releases.atom | https://github.com/angular/angular | angular, release | yes |  |
| Angular CLI releases | https://github.com/angular/angular-cli/releases.atom | https://github.com/angular/angular-cli | angular, cli, release | yes |  |
| Angular components releases | https://github.com/angular/components/releases.atom | https://github.com/angular/components | angular, material, release | yes |  |
| NgRx releases | https://github.com/ngrx/platform/releases.atom | https://ngrx.io | angular, ngrx, release | yes |  |
| Ninja Squad | https://blog.ninja-squad.com/atom.xml | https://blog.ninja-squad.com | angular | yes |  |
| Angular Architects | https://www.angulararchitects.io/en/feed/ | https://www.angulararchitects.io/en/blog/ | angular, architecture | yes |  |
| Angular Space | https://www.angularspace.com/rss/ | https://www.angularspace.com | angular | yes |  |
| Angular University | https://blog.angular-university.io/rss/ | https://blog.angular-university.io | angular | yes |  |
| Angular Training Blog | https://blog.angulartraining.com/feed | https://blog.angulartraining.com | angular | yes |  |
| Angular Addicts | https://www.angularaddicts.com/feed | https://www.angularaddicts.com | angular, newsletter | yes |  |
| Angular in Depth | https://angularindepth.com/feed.xml | https://angularindepth.com | angular, community | no |  |

## .NET

| Name | Feed | Website | Tags | Enabled | Selectors |
| --- | --- | --- | --- | --- | --- |
| .NET Blog | https://devblogs.microsoft.com/dotnet/feed/ | https://devblogs.microsoft.com/dotnet | dotnet, csharp | yes |  |
| .NET releases | https://github.com/dotnet/core/releases.atom | https://github.com/dotnet/core | dotnet, release | yes |  |
| Aspire releases | https://github.com/dotnet/aspire/releases.atom | https://github.com/dotnet/aspire | dotnet, aspire, release | yes |  |
| .NET MAUI releases | https://github.com/dotnet/maui/releases.atom | https://github.com/dotnet/maui | dotnet, maui, release | no |  |
| Visual Studio Blog | https://devblogs.microsoft.com/visualstudio/feed/ | https://devblogs.microsoft.com/visualstudio | visualstudio, dotnet | yes |  |
| JetBrains .NET Blog | https://blog.jetbrains.com/dotnet/feed/ | https://blog.jetbrains.com/dotnet | dotnet, rider | yes |  |
| InfoQ .NET | https://feed.infoq.com/dotnet/ | https://www.infoq.com/dotnet | dotnet | yes |  |
| Visual Studio Magazine | https://visualstudiomagazine.com/rss-feeds/news.aspx | https://visualstudiomagazine.com | dotnet | yes |  |
| Andrew Lock – .NET Escapades | https://andrewlock.net/rss.xml | https://andrewlock.net | aspnetcore, dotnet | yes |  |
| Milan Jovanović | https://www.milanjovanovic.tech/rss/feed.xml | https://www.milanjovanovic.tech | dotnet, architecture | yes |  |
| Rick Strahl's Web Log | https://feeds.feedburner.com/rickstrahl | https://weblog.west-wind.com | aspnetcore, dotnet | yes |  |
| Damien Bowden | https://damienbod.com/feed/ | https://damienbod.com | aspnetcore, security | yes |  |
| elmah.io blog | https://blog.elmah.io/rss/ | https://blog.elmah.io | dotnet, aspnetcore | yes |  |
| C# Digest | https://csharpdigest.net/newsletters.rss | https://csharpdigest.net | csharp, newsletter | yes |  |

## Both

| Name | Feed | Website | Tags | Enabled | Selectors |
| --- | --- | --- | --- | --- | --- |
| TypeScript Blog | https://devblogs.microsoft.com/typescript/feed/ | https://devblogs.microsoft.com/typescript | typescript | yes |  |
