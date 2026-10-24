# News sources

The gather reads every **enabled** source below. Edit this file or use **Admin → Sources**, which saves its changes
to this file.

- One table row per source. `##` headings group sources into sections.
- **Feed**: an RSS/Atom link, or a web page link when **Selectors** is filled in.
- **Tags**: comma separated; used when the AI can't tag a story.
- **Enabled**: `yes` or `no`.
- **Selectors** (only for sites without a feed): `item=…; title=…; link=…; date=…; summary=…`.
  Add `@attr` to read an attribute, e.g. `link=a@href`.

## Angular

| Name | Feed | Website | Tags | Enabled | Selectors |
| --- | --- | --- | --- | --- | --- |
| Angular Blog | https://blog.angular.dev/feed | https://blog.angular.dev | angular | yes |  |
| Angular releases | https://github.com/angular/angular/releases.atom | https://github.com/angular/angular | angular, release | yes |  |
| Angular CLI releases | https://github.com/angular/angular-cli/releases.atom | https://github.com/angular/angular-cli | angular, cli, release | yes |  |
| Angular Training Blog | https://blog.angulartraining.com/feed | https://blog.angulartraining.com | angular | yes |  |
| Angular Addicts | https://www.angularaddicts.com/feed | https://www.angularaddicts.com | angular, newsletter | yes |  |
| Angular Digest | https://geromegrignon.substack.com/feed | https://geromegrignon.substack.com | angular, newsletter | yes |  |
| Syncfusion Angular Blog | https://www.syncfusion.com/blogs/category/angular/feed | https://www.syncfusion.com/blogs | angular | yes |  |
| DEV #angular | https://dev.to/feed/tag/angular | https://dev.to/t/angular | angular, community | no |  |

## .NET

| Name | Feed | Website | Tags | Enabled | Selectors |
| --- | --- | --- | --- | --- | --- |
| .NET Blog | https://devblogs.microsoft.com/dotnet/feed/ | https://devblogs.microsoft.com/dotnet | dotnet, csharp | yes |  |
| Visual Studio Blog | https://devblogs.microsoft.com/visualstudio/feed/ | https://devblogs.microsoft.com/visualstudio | visualstudio, dotnet | yes |  |
| .NET runtime releases | https://github.com/dotnet/runtime/releases.atom | https://github.com/dotnet/runtime | dotnet, release | yes |  |
| ASP.NET Core releases | https://github.com/dotnet/aspnetcore/releases.atom | https://github.com/dotnet/aspnetcore | aspnetcore, release | yes |  |
| EF Core releases | https://github.com/dotnet/efcore/releases.atom | https://github.com/dotnet/efcore | efcore, release | yes |  |
| Andrew Lock – .NET Escapades | https://andrewlock.net/rss.xml | https://andrewlock.net | aspnetcore, dotnet | yes |  |
| Milan Jovanović | https://www.milanjovanovic.tech/rss/feed.xml | https://www.milanjovanovic.tech | dotnet, architecture | yes |  |
| JetBrains .NET Blog | https://blog.jetbrains.com/dotnet/feed/ | https://blog.jetbrains.com/dotnet | dotnet, rider | yes |  |
| Rick Strahl's Web Log | https://feeds.feedburner.com/rickstrahl | https://weblog.west-wind.com | aspnetcore, dotnet | yes |  |
| Damien Bowden | https://damienbod.com/feed/ | https://damienbod.com | aspnetcore, security | yes |  |
| Code Maze | https://code-maze.com/feed/ | https://code-maze.com | dotnet | yes |  |
| InfoQ .NET | https://feed.infoq.com/dotnet/ | https://www.infoq.com/dotnet | dotnet | yes |  |
| DEV #dotnet | https://dev.to/feed/tag/dotnet | https://dev.to/t/dotnet | dotnet, community | no |  |
| .NET Ramblings | https://www.dotnetramblings.com/index.xml | https://www.dotnetramblings.com | dotnet, aggregator | no |  |

## Cross-stack

| Name | Feed | Website | Tags | Enabled | Selectors |
| --- | --- | --- | --- | --- | --- |
| TypeScript Blog | https://devblogs.microsoft.com/typescript/feed/ | https://devblogs.microsoft.com/typescript | typescript | yes |  |
| Telerik Blogs | https://www.telerik.com/blogs/rss | https://www.telerik.com/blogs | angular, dotnet | no |  |
