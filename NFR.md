1. PERFORMANCE :
response time ? 
procesingtime+ waiting time = end-to-end latency 
how is teh response time measured when one request waiting for another request to complete(waiting time)?

response time distribution ? median?average?maximum?

bucket them into histogram..generate percentile 
response time percentile distribution..tail latency ...short tail latency is preferred.

set best goals 

---------------------------------------------------------------

Throughput?
what through put metrics are measured?

other performance metrics .

-----------------------------------------------------------------

degradation point measured?

what degradation points are measured ? what are current values , can we increase ?

we need to publish teh metrics with histograms/degradation points to improve credibility.

Once we degradation points/metrics, we need to know how to maintain/manage the performance? best practices ?publish 

aim for better tail latency

which are the best perfomance metrics for tealtiger success? what are the performance metrics tradeoffs?

Add this to next versions.
---------------------------------------------------------

2. SCALABILITY:

    vertical/horizontal/orgnizational
   How tealtiger handles scalability? what if user want to scale vertically? what can he do ?applies to all scalability options.
--------------------------------------------------------

3. Availability

   uptime/downtime

   MTBF-mean time between failure
   MTTR

   fault-tolerance, failure preventio, detection/isolation , recovery
   ---------------------------------------------------------------------------------

   SLO(service level objectives), we need SLOs in oreder for users to know what to expect from tealTiger
   SLI(Service level indicators )?
   Only metrics that users care about , not every metric that system produces is required.
   Define SLOs, around those metrics
   From that, right SLis to rack those SLOs to be found
   only few SLos needed
   Recovery plan (publish) for developers
