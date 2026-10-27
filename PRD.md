The plan is to make a browser AD Block extension. It should contain the following parts:



* FRONTEND: A small minimalistic frontend pop up UI in the top right corner of the tab page. The UI should contain a centered power button that switches the ad block extension ON and OFF, and have a close UI button. It should also display the number of ads blocked, along with the pop up ads blocked.
* BACKEND: The provided table shall give the necessary guidelines to adhere(any additional features are also welcome):

|Type of Advertisements:|Example for places of occurrence:|How to be handled/dealt with:|
|-|-|-|
|On page advertisement|News websites, online games websites. Their format ranges from images to gifs or videos. These ads load on the page's free spaces, usually above, bellow or sides of the essential content the user requires from the page. These don't really hinder the user.|The AD content should never load onto the page|
|In video advertisement|Streaming websites like YouTube and other such pages. These ads are in video format and are either skippable after a time limit, or un-skippable.|The video advert should be dealt with in such a manner that the user should not wait for the ad to reach the skip counter|
|Pop-up advertisement|Free video to audio converting websites or online games websites. These do not send you to a different page but load up as an overlay in front of the page you are trying to view.|The advert overlay should never happen over the web page, and the pop up should be notified as a minimal pop at the bottom of the page which will fade away in 2-3 seconds. <br /><br />There may be exceptions such as Login pages, Selection tabs, etc|
|Redirect advertisement|Free online tools like YouTube to .MP4 converters. These ads are highly unsafe as it forcibly moves the user away from the current page into a totally different one.|The redirecting should be blocked before it gets the chance and be notified as a minimal pop at the bottom of the page will fade away in 2-3 second. <br /><br />There may be certain exceptions to this rule such as login pages, intentional download page, intended redirects by the website(not an advert), or it's a pdf that is previewing, etc.<br /><br />SPECIAL CASE: Some websites MANDATORILY requires the user to stay on a redirected page for a certain amount of time before the rewarding the user the feature/intended page. For these cases, the extension should make a micro environment where the redirect ad page exists very briefly (if the wait is 10 seconds, it should be completed within 1 second) and send the user to the intended page or activate the feature|



* Secure and safe micro environment layer: This layer should contain the redirect micro environment SAFELY in such a way that it can't the user nor deliver any harm. This layer should completely dissolve the redirect page after returning the reward/intended page.
* Firewall: Any suspicious page should be notified to the user before fully loading the entire page. Any trojan horse website shall never auto download any unwanted files into the system.


All these functions should run locally on the user's device. Every delicate info such as PII, vulnerable API's and functionalities, etc should be invisible from the page's point of view to ensure no backdoors exist and establish security


Any extra files for functionality are welcome.



